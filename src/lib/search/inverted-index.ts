/**
 * Inverted index for full-text search.
 *
 * Maps every unique word token → the file IDs and line numbers where it
 * appears. Supports millisecond full-text queries.
 *
 * Tokenization:
 *  - Lowercase folding
 *  - Split on non-word characters
 *  - Stop-word filtering (the, a, an, is, …) — these are too common to be
 *    useful and bloat the index
 *  - Min token length: 2 characters
 *
 * The index is built once on vault open and incrementally updated on file
 * edit (same pattern as the link index). Persisted to the link index store
 * alongside the graph data.
 */

import type { FileId } from "@/lib/vault/types";

/** A posting: where a token appears. */
export interface Posting {
  fileId: FileId;
  /** Line numbers (0-based) where the token appears. */
  lines: number[];
  /** Term frequency (count of occurrences in this file). */
  tf: number;
}

/** The inverted index: token → postings. */
export interface InvertedIndex {
  /** token → array of postings (one per file). */
  postings: Map<string, Posting[]>;
  /** Total document count (for IDF computation). */
  docCount: number;
  /** Per-file document length (token count, for BM25). */
  docLengths: Map<FileId, number>;
  /** Average document length. */
  avgDocLength: number;
}

/** Common English stop words to filter out. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "should", "could", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "up", "down", "out", "off", "over", "under", "again", "further",
  "then", "once", "here", "there", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just", "this",
  "that", "these", "those", "i", "you", "he", "she", "it", "we", "they",
]);

/** Tokenize a string into searchable tokens. */
export function tokenizeText(text: string): { token: string; line: number }[] {
  const tokens: { token: string; line: number }[] = [];
  const lines = text.split("\n");
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    // Split on non-word characters, keep word tokens.
    const words = line.split(/[^\w]+/);
    for (const word of words) {
      if (word.length < 2) continue;
      const lower = word.toLowerCase();
      if (STOP_WORDS.has(lower)) continue;
      tokens.push({ token: lower, line: lineNum });
    }
  }
  return tokens;
}

/** Build an inverted index from a set of files. */
export function buildInvertedIndex(
  files: { fileId: FileId; content: string }[]
): InvertedIndex {
  const postings = new Map<string, Posting[]>();
  const docLengths = new Map<FileId, number>();
  let totalLength = 0;

  for (const { fileId, content } of files) {
    const tokens = tokenizeText(content);
    docLengths.set(fileId, tokens.length);
    totalLength += tokens.length;

    // Group by token for this file.
    const tokenLines = new Map<string, number[]>();
    const tokenTf = new Map<string, number>();
    for (const { token, line } of tokens) {
      const lines = tokenLines.get(token);
      if (lines) {
        if (!lines.includes(line)) lines.push(line);
      } else {
        tokenLines.set(token, [line]);
      }
      tokenTf.set(token, (tokenTf.get(token) ?? 0) + 1);
    }

    // Merge into global postings.
    for (const [token, lines] of tokenLines) {
      const tf = tokenTf.get(token) ?? 1;
      const posting: Posting = { fileId, lines, tf };
      const arr = postings.get(token);
      if (arr) arr.push(posting);
      else postings.set(token, [posting]);
    }
  }

  return {
    postings,
    docCount: files.length,
    docLengths,
    avgDocLength: files.length > 0 ? totalLength / files.length : 0,
  };
}

/**
 * Incrementally update the inverted index for a single file.
 * Removes old postings for this file, adds new ones.
 */
export function incrementalUpdateInverted(
  index: InvertedIndex,
  fileId: FileId,
  content: string
): InvertedIndex {
  // Remove old postings for this file.
  for (const [token, arr] of index.postings) {
    const filtered = arr.filter((p) => p.fileId !== fileId);
    if (filtered.length === 0) {
      index.postings.delete(token);
    } else if (filtered.length !== arr.length) {
      index.postings.set(token, filtered);
    }
  }

  // Update doc length.
  const oldLen = index.docLengths.get(fileId) ?? 0;
  const tokens = tokenizeText(content);
  index.docLengths.set(fileId, tokens.length);
  // Recompute avgDocLength.
  const totalLen = [...index.docLengths.values()].reduce((a, b) => a + b, 0);
  index.avgDocLength = index.docLengths.size > 0 ? totalLen / index.docLengths.size : 0;

  // Add new postings.
  const tokenLines = new Map<string, number[]>();
  const tokenTf = new Map<string, number>();
  for (const { token, line } of tokens) {
    const lines = tokenLines.get(token);
    if (lines) {
      if (!lines.includes(line)) lines.push(line);
    } else {
      tokenLines.set(token, [line]);
    }
    tokenTf.set(token, (tokenTf.get(token) ?? 0) + 1);
  }
  void oldLen;

  for (const [token, lines] of tokenLines) {
    const tf = tokenTf.get(token) ?? 1;
    const posting: Posting = { fileId, lines, tf };
    const arr = index.postings.get(token);
    if (arr) arr.push(posting);
    else index.postings.set(token, [posting]);
  }

  return index;
}

/** Remove a file from the inverted index. */
export function removeFileFromInverted(index: InvertedIndex, fileId: FileId): void {
  for (const [token, arr] of index.postings) {
    const filtered = arr.filter((p) => p.fileId !== fileId);
    if (filtered.length === 0) {
      index.postings.delete(token);
    } else {
      index.postings.set(token, filtered);
    }
  }
  index.docLengths.delete(fileId);
  const totalLen = [...index.docLengths.values()].reduce((a, b) => a + b, 0);
  index.avgDocLength = index.docLengths.size > 0 ? totalLen / index.docLengths.size : 0;
  index.docCount = index.docLengths.size;
}

/** Empty inverted index. */
export function emptyInvertedIndex(): InvertedIndex {
  return {
    postings: new Map(),
    docCount: 0,
    docLengths: new Map(),
    avgDocLength: 0,
  };
}

/** Look up postings for a token. */
export function getPostings(index: InvertedIndex, token: string): Posting[] {
  return index.postings.get(token.toLowerCase()) ?? [];
}
