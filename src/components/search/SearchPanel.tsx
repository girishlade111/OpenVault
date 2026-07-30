"use client";

import { useMemo, useState } from "react";
import { Search, FileText, X, CornerDownRight } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import { parseQuery } from "@/lib/search/query-parser";
import { executeSearch, type SearchResult } from "@/lib/search/search-executor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * Search panel — advanced full-text search with boolean operators.
 *
 * Query syntax:
 *  - `term1 term2`          → implicit AND
 *  - `term1 OR term2`       → OR
 *  - `NOT term`             → exclude
 *  - `"exact phrase"`       → phrase match
 *  - `tag:concept`          → filter by tag
 *  - `path:Concepts`        → filter by path
 *  - `file:Zettel`          → filter by filename
 *  - `(a OR b) AND c`       → grouping
 *
 * Results are ranked by BM25, with context snippets and highlighted matches.
 * Click a result to open it in the active editor leaf.
 */
export function SearchPanel({ onClose }: { onClose?: () => void }) {
  const [query, setQuery] = useState("");
  const manifest = useVaultStore((s) => s.manifest);
  const contentCache = useVaultStore((s) => s.contentCache);
  const index = useIndexStore((s) => s.index);
  const inverted = useIndexStore((s) => s.inverted);
  const openFile = useVaultStore((s) => s.openFile);

  // Execute the search reactively.
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim() || !index || !inverted || !manifest) return [];
    const ast = parseQuery(query);
    if (!ast) return [];
    try {
      return executeSearch(ast, inverted, index, manifest, contentCache);
    } catch {
      return [];
    }
  }, [query, index, inverted, manifest, contentCache]);

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Search input */}
      <div className="border-b p-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… (tag:concept OR path:Daily)"
            className="h-8 pl-8 pr-8 text-sm bg-muted/40 border-transparent focus-visible:bg-background focus-visible:border-border"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* Syntax hints */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {["AND", "OR", "NOT", "tag:", "path:", "file:", '"phrase"'].map((hint) => (
            <button
              key={hint}
              onClick={() => setQuery((q) => (q ? `${q} ${hint}` : hint))}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent hover:text-foreground font-mono"
            >
              {hint}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      {query.trim() && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b shrink-0">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Results list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {results.length === 0 && query.trim() && (
            <p className="text-xs text-muted-foreground italic px-2 py-4 text-center">
              No results for “{query}”.
            </p>
          )}
          {results.length === 0 && !query.trim() && (
            <p className="text-xs text-muted-foreground italic px-2 py-4 text-center">
              Type to search across all notes.
            </p>
          )}
          {results.map((result, i) => (
            <ResultRow
              key={`${result.fileId}-${i}`}
              result={result}
              manifest={manifest}
              onOpen={() => openFile(result.fileId)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function ResultRow({
  result,
  manifest,
  onOpen,
}: {
  result: SearchResult;
  manifest: ReturnType<typeof useVaultStore.getState>["manifest"];
  onOpen: () => void;
}) {
  const node = manifest?.nodes[result.fileId];
  if (!node) return null;

  return (
    <button
      onClick={onOpen}
      className="group w-full text-left flex items-start gap-2 p-2 rounded-sm hover:bg-accent/50 transition-colors"
    >
      <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{node.name}</span>
          <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal shrink-0">
            {result.score.toFixed(1)}
          </Badge>
          {result.matchLines.length > 0 && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              L{result.matchLines[0] + 1}
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {node.path}
        </div>
        {result.snippet && (
          <div className="mt-1 text-xs font-mono text-muted-foreground line-clamp-2 bg-muted/30 rounded px-1.5 py-1">
            <HighlightedSnippet
              snippet={result.snippet}
              matches={result.snippetMatches}
            />
          </div>
        )}
      </div>
      <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  );
}

function HighlightedSnippet({
  snippet,
  matches,
}: {
  snippet: string;
  matches: { from: number; to: number }[];
}) {
  if (matches.length === 0) return <span>{snippet}</span>;
  // Build a highlighted version of the snippet.
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  const sorted = [...matches].sort((a, b) => a.from - b.from);
  for (const m of sorted) {
    if (m.from > lastEnd) {
      parts.push(<span key={lastEnd}>{snippet.slice(lastEnd, m.from)}</span>);
    }
    parts.push(
      <mark key={m.from} className="bg-primary/30 text-foreground rounded px-0.5">
        {snippet.slice(m.from, m.to)}
      </mark>
    );
    lastEnd = m.to;
  }
  if (lastEnd < snippet.length) {
    parts.push(<span key={lastEnd}>{snippet.slice(lastEnd)}</span>);
  }
  return <>{parts}</>;
}
