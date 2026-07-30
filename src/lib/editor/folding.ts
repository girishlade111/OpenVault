/**
 * Folding logic.
 *
 * A "foldable" range is a contiguous span of lines that can be collapsed into
 * a single placeholder. We support two structural fold kinds:
 *
 *  - Heading fold: an ATX heading at level N folds all following lines until
 *    the next heading of level ≤ N (or end of document). This matches
 *    Obsidian's heading-fold behaviour.
 *  - List-item fold: a list item at depth D folds all following list items at
 *    depth > D (its descendants) until the next sibling or a non-list line.
 *
 * Folding is implemented as CodeMirror line decorations that replace the
 * hidden lines with a 0-height widget, so the underlying text buffer is
 * untouched and cursor navigation automatically skips hidden ranges (CodeMirror
 * natively clamps the selection out of replaced/dimmed ranges).
 *
 * This module exports a pure `computeFoldableRanges(text)` function returning
 * `{ from, to }` line ranges. The CodeMirror extension in `extensions.ts`
 * consumes it to build the fold gutter + the fold/unfold state.
 */

import { deriveBlocks, type Block } from "./blocks";

export interface FoldRange {
  /** Start line (0-based, inclusive) — the heading/item line itself. */
  fromLine: number;
  /** End line (0-based, inclusive) — last hidden line. */
  toLine: number;
  kind: "heading" | "list-item";
  /** Heading level or list depth — used for nested-fold computation. */
  level: number;
}

/** Compute every foldable range in the document. */
export function computeFoldableRanges(text: string): FoldRange[] {
  const blocks = deriveBlocks(text);
  const lines = text.split("\n");
  const ranges: FoldRange[] = [];

  // Heading folds.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "heading" || !b.level) continue;
    const level = b.level;
    let endLine = b.fromLine;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (next.kind === "heading" && (next.level ?? 0) <= level) break;
      endLine = next.toLine;
    }
    if (endLine > b.fromLine) {
      ranges.push({ fromLine: b.fromLine, toLine: endLine, kind: "heading", level });
    }
  }

  // List-item folds: an item folds its deeper-depth descendants.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "list-item" || b.depth === undefined) continue;
    let endLine = b.fromLine;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (next.kind !== "list-item") break;
      if ((next.depth ?? 0) <= (b.depth ?? 0)) break;
      endLine = next.toLine;
    }
    if (endLine > b.fromLine) {
      ranges.push({ fromLine: b.fromLine, toLine: endLine, kind: "list-item", level: b.depth });
    }
  }

  void lines;
  return ranges;
}

/** Helper: is the given line the start of a foldable range? */
export function foldStartAt(ranges: FoldRange[], line: number): FoldRange | null {
  return ranges.find((r) => r.fromLine === line) ?? null;
}

/** Re-export Block for consumers that want both. */
export type { Block };
