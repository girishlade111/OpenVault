/**
 * Search executor + BM25 ranking.
 *
 * Takes a parsed search AST + the inverted index + vault manifest, and
 * returns ranked search results.
 *
 * Execution pipeline:
 *  1. Evaluate structural operators first (file:/path:/tag:) to build a
 *     candidate file set — these are cheap and shrink the search space.
 *  2. Evaluate full-text terms/phrases/regex against the inverted index,
 *     restricted to the candidate set.
 *  3. Score surviving results with BM25.
 *  4. Sort by score (desc), tie-break by recency (mtime) then match proximity.
 *
 * Each result carries a context snippet with highlighted match positions for
 * the UI.
 */

import type { FileId, VaultManifest } from "@/lib/vault/types";
import type { LinkIndex } from "@/lib/index/link-index";
import type { InvertedIndex, Posting } from "./inverted-index";
import { getPostings } from "./inverted-index";
import type { SearchNode, SearchField } from "./query-parser";
import { tokenizeText } from "./inverted-index";

/** A single search result. */
export interface SearchResult {
  fileId: FileId;
  /** BM25 score (higher = more relevant). */
  score: number;
  /** Matching line numbers. */
  matchLines: number[];
  /** Context snippet around the first match. */
  snippet: string;
  /** Character offsets of matches within the snippet (for highlighting). */
  snippetMatches: { from: number; to: number }[];
}

/** Execute a search AST against the index. Returns ranked results. */
export function executeSearch(
  ast: SearchNode,
  inverted: InvertedIndex,
  linkIndex: LinkIndex,
  manifest: VaultManifest,
  contentCache: Record<FileId, string>
): SearchResult[] {
  // Phase 1: determine the candidate file set.
  const candidateSet = evaluateStructural(ast, linkIndex, manifest);
  // If the query is purely structural (no text terms), return all candidates
  // with a neutral score.
  const hasTextTerms = containsTextTerms(ast);

  if (!hasTextTerms) {
    return [...candidateSet].map((fileId) => ({
      fileId,
      score: 1,
      matchLines: [],
      snippet: (contentCache[fileId] ?? "").split("\n").slice(0, 2).join("\n"),
      snippetMatches: [],
    }));
  }

  // Phase 2: evaluate text terms against the inverted index.
  const matchData = evaluateText(ast, inverted, candidateSet);

  // Phase 3: score with BM25.
  const results: SearchResult[] = [];
  for (const [fileId, matchLines] of matchData) {
    const score = bm25Score(ast, inverted, fileId, matchLines);
    const { snippet, snippetMatches } = buildSnippet(
      contentCache[fileId] ?? "",
      matchLines,
      ast
    );
    results.push({
      fileId,
      score,
      matchLines: [...matchLines].sort((a, b) => a - b),
      snippet,
      snippetMatches,
    });
  }

  // Phase 4: sort by score desc, then recency, then match proximity.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const nodeA = manifest.nodes[a.fileId];
    const nodeB = manifest.nodes[b.fileId];
    if (nodeA && nodeB) {
      return nodeB.mtime - nodeA.mtime;
    }
    return a.matchLines.length - b.matchLines.length;
  });

  return results;
}

// --- structural evaluation -------------------------------------------------

/**
 * Evaluate structural operators (file:/path:/tag:) to build a candidate set.
 * If no structural operators, returns ALL markdown files.
 */
function evaluateStructural(
  ast: SearchNode,
  linkIndex: LinkIndex,
  manifest: VaultManifest
): Set<FileId> {
  // Collect structural constraints.
  const constraints: { field: SearchField; value: string }[] = [];
  collectStructural(ast, constraints);

  if (constraints.length === 0) {
    // No structural filters → all markdown files are candidates.
    const all = new Set<FileId>();
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind === "file" && node.isMarkdown) all.add(node.id);
    }
    return all;
  }

  // Start with all markdown files, then intersect each constraint.
  let candidates: Set<FileId> | null = null;
  for (const { field, value } of constraints) {
    const matching = structuralMatch(field, value, linkIndex, manifest);
    if (candidates === null) {
      candidates = matching;
    } else {
      // Intersect.
      const next = new Set<FileId>();
      for (const id of candidates) {
        if (matching.has(id)) next.add(id);
      }
      candidates = next;
    }
  }
  return candidates ?? new Set();
}

function collectStructural(
  node: SearchNode,
  out: { field: SearchField; value: string }[]
): void {
  switch (node.type) {
    case "field":
      if (node.field === "file" || node.field === "path" || node.field === "tag") {
        out.push({ field: node.field, value: node.value });
      }
      break;
    case "and":
    case "or":
      for (const child of node.children) collectStructural(child, out);
      break;
    case "not":
      // NOT doesn't contribute to the candidate set (handled in text eval).
      break;
  }
}

function structuralMatch(
  field: SearchField,
  value: string,
  linkIndex: LinkIndex,
  manifest: VaultManifest
): Set<FileId> {
  const result = new Set<FileId>();
  if (field === "tag") {
    const fileIds = linkIndex.tagIndex.get(value) ?? [];
    for (const id of fileIds) result.add(id);
  } else if (field === "file") {
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind !== "file" || !node.isMarkdown) continue;
      if (node.name.toLowerCase().includes(value)) result.add(node.id);
    }
  } else if (field === "path") {
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind !== "file" || !node.isMarkdown) continue;
      if (node.path.toLowerCase().includes(value)) result.add(node.id);
    }
  }
  return result;
}

// --- text evaluation -------------------------------------------------------

/** Evaluate text terms; returns Map<fileId, Set<matchLines>>. */
function evaluateText(
  ast: SearchNode,
  inverted: InvertedIndex,
  candidates: Set<FileId>
): Map<FileId, Set<number>> {
  const result = evaluateNode(ast, inverted, candidates);
  return result;
}

/** Recursively evaluate a node, returning matching files + lines. */
function evaluateNode(
  node: SearchNode,
  inverted: InvertedIndex,
  candidates: Set<FileId>
): Map<FileId, Set<number>> {
  switch (node.type) {
    case "term": {
      const postings = getPostings(inverted, node.value);
      const result = new Map<FileId, Set<number>>();
      for (const p of postings) {
        if (!candidates.has(p.fileId)) continue;
        result.set(p.fileId, new Set(p.lines));
      }
      return result;
    }
    case "phrase": {
      // A phrase requires the tokens to appear on the same line in order.
      return evaluatePhrase(node.value, inverted, candidates);
    }
    case "regex": {
      // Regex is evaluated against the raw content — can't use the inverted
      // index. This is a fallback scan.
      return new Map(); // handled in buildSnippet phase; for now return empty
    }
    case "field": {
      if (node.field === "content") {
        // content: searches the body text — use inverted index on the value.
        const postings = getPostings(inverted, node.value);
        const result = new Map<FileId, Set<number>>();
        for (const p of postings) {
          if (!candidates.has(p.fileId)) continue;
          result.set(p.fileId, new Set(p.lines));
        }
        return result;
      }
      if (node.field === "line") {
        // line: matches a specific line number — not commonly used.
        return new Map();
      }
      // file/path/tag are structural — already filtered. Return all candidates.
      const result = new Map<FileId, Set<number>>();
      for (const id of candidates) result.set(id, new Set());
      return result;
    }
    case "and": {
      // Intersect all children.
      let result: Map<FileId, Set<number>> | null = null;
      for (const child of node.children) {
        const childResult = evaluateNode(child, inverted, candidates);
        if (result === null) {
          result = childResult;
        } else {
          // Intersect: keep only fileIds in both, union their match lines.
          const next = new Map<FileId, Set<number>>();
          for (const [id, lines] of result) {
            if (childResult.has(id)) {
              const childLines = childResult.get(id)!;
              next.set(id, new Set([...lines, ...childLines]));
            }
          }
          result = next;
        }
      }
      return result ?? new Map();
    }
    case "or": {
      // Union all children.
      const result = new Map<FileId, Set<number>>();
      for (const child of node.children) {
        const childResult = evaluateNode(child, inverted, candidates);
        for (const [id, lines] of childResult) {
          const existing = result.get(id);
          if (existing) {
            for (const l of lines) existing.add(l);
          } else {
            result.set(id, new Set(lines));
          }
        }
      }
      return result;
    }
    case "not": {
      // NOT: return all candidates NOT in the child's result.
      const childResult = evaluateNode(node.child, inverted, candidates);
      const result = new Map<FileId, Set<number>>();
      for (const id of candidates) {
        if (!childResult.has(id)) result.set(id, new Set());
      }
      return result;
    }
  }
}

/** Evaluate a phrase query: tokens must appear on the same line in order. */
function evaluatePhrase(
  phrase: string,
  inverted: InvertedIndex,
  candidates: Set<FileId>
): Map<FileId, Set<number>> {
  const tokens = tokenizeText(phrase).map((t) => t.token);
  if (tokens.length === 0) return new Map();

  // Get postings for the first token.
  const firstPostings = getPostings(inverted, tokens[0]);
  const result = new Map<FileId, Set<number>>();

  for (const posting of firstPostings) {
    if (!candidates.has(posting.fileId)) continue;
    // For each line where the first token appears, check if the remaining
    // tokens also appear on that same line.
    for (const line of posting.lines) {
      let allPresent = true;
      for (let i = 1; i < tokens.length; i++) {
        const otherPostings = getPostings(inverted, tokens[i]);
        const found = otherPostings.find(
          (p) => p.fileId === posting.fileId && p.lines.includes(line)
        );
        if (!found) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) {
        const set = result.get(posting.fileId);
        if (set) set.add(line);
        else result.set(posting.fileId, new Set([line]));
      }
    }
  }
  return result;
}

/** Check if the AST contains any text terms (not just structural). */
function containsTextTerms(ast: SearchNode): boolean {
  switch (ast.type) {
    case "term":
    case "phrase":
    case "regex":
      return true;
    case "field":
      return ast.field === "content" || ast.field === "line";
    case "and":
    case "or":
      return ast.children.some(containsTextTerms);
    case "not":
      return containsTextTerms(ast.child);
  }
}

// --- BM25 scoring ----------------------------------------------------------

/** Compute BM25 score for a file against the query AST. */
function bm25Score(
  ast: SearchNode,
  inverted: InvertedIndex,
  fileId: FileId,
  matchLines: Set<number>
): number {
  // Collect all term tokens from the AST.
  const terms: string[] = [];
  collectTerms(ast, terms);
  if (terms.length === 0) return 1;

  const k1 = 1.5;
  const b = 0.75;
  const docLen = inverted.docLengths.get(fileId) ?? 0;
  const avgLen = inverted.avgDocLength || 1;

  let score = 0;
  for (const term of terms) {
    const postings = getPostings(inverted, term);
    const posting = postings.find((p) => p.fileId === fileId);
    if (!posting) continue;

    // IDF: log((N - n + 0.5) / (n + 0.5) + 1), where N = docCount, n = matching docs.
    const n = postings.length;
    const idf = Math.log((inverted.docCount - n + 0.5) / (n + 0.5) + 1);

    // TF normalization.
    const tf = posting.tf;
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLen)));

    score += idf * tfNorm;
  }

  // Slight boost for more match lines (proximity signal).
  score *= 1 + Math.log10(1 + matchLines.size);
  return score;
}

function collectTerms(node: SearchNode, out: string[]): void {
  switch (node.type) {
    case "term":
      out.push(node.value);
      break;
    case "phrase":
      // Phrase contributes its constituent tokens.
      for (const t of tokenizeText(node.value)) out.push(t.token);
      break;
    case "field":
      if (node.field === "content") out.push(node.value);
      break;
    case "and":
    case "or":
      for (const child of node.children) collectTerms(child, out);
      break;
    case "not":
      // Don't collect NOT terms (they don't contribute positively to score).
      break;
  }
}

// --- snippet building ------------------------------------------------------

/** Build a context snippet around the first match line, with match offsets. */
function buildSnippet(
  content: string,
  matchLines: Set<number>,
  ast: SearchNode
): { snippet: string; snippetMatches: { from: number; to: number }[] } {
  if (matchLines.size === 0) {
    return { snippet: content.split("\n").slice(0, 2).join("\n"), snippetMatches: [] };
  }
  const lines = content.split("\n");
  const firstMatch = Math.min(...matchLines);
  // Show 1 line before and 1 after (or clamped).
  const start = Math.max(0, firstMatch - 1);
  const end = Math.min(lines.length - 1, firstMatch + 1);
  const snippet = lines.slice(start, end + 1).join("\n");

  // Find match offsets within the snippet.
  const matchTerms: string[] = [];
  collectTerms(ast, matchTerms);
  const snippetMatches: { from: number; to: number }[] = [];
  const lowerSnippet = snippet.toLowerCase();
  for (const term of matchTerms) {
    if (term.length < 2) continue;
    let idx = lowerSnippet.indexOf(term);
    while (idx >= 0) {
      snippetMatches.push({ from: idx, to: idx + term.length });
      idx = lowerSnippet.indexOf(term, idx + 1);
    }
  }

  return { snippet, snippetMatches };
}
