/**
 * Outliner drag-and-drop algorithm.
 *
 * When a user drags a list item and drops it elsewhere, the algorithm must:
 *
 *  1. Identify the dragged item AND all its nested descendants (the subtree).
 *  2. Compute the new depth based on the drop target's indentation.
 *  3. Re-indent the dragged item and every descendant by the delta between
 *     old and new depth (so the subtree's internal structure is preserved).
 *  4. Splice the subtree out of its original position and into the target
 *     position in a single transactional text rewrite.
 *
 * The function is PURE: it takes the document text + drag descriptor and
 * returns the new document text (or null if the move is invalid/no-op).
 * The CodeMirror wrapper applies it as a single `dispatch({ changes })` so
 * the undo stack records one atomic operation.
 *
 * Indentation unit is 2 spaces (configurable). Marker is preserved per item.
 */

import { deriveBlocks, indentForDepth, type Block } from "./blocks";

export interface DragDescriptor {
  /** 0-based line of the dragged list item. */
  fromLine: number;
  /** 0-based line of the drop target list item (the new parent/sibling). */
  toLine: number;
  /**
   * "child" — dropped as a child of the target (depth = target.depth + 1).
   * "before" — dropped as the previous sibling of the target (same depth).
   * "after" — dropped as the next sibling of the target (same depth).
   */
  position: "child" | "before" | "after";
}

export interface DragResult {
  /** New full document text after the move. */
  text: string;
  /** New line number of the dragged item's first line (for cursor restore). */
  newFromLine: number;
}

/**
 * Apply a list-item drag. Returns null if the move is invalid (e.g. dragging
 * an item into its own descendant, or a non-list target).
 */
export function applyListItemDrag(
  text: string,
  drag: DragDescriptor
): DragResult | null {
  const blocks = deriveBlocks(text);
  const lines = text.split("\n");

  // Locate the dragged block.
  const dragged = blocks.find((b) => b.fromLine === drag.fromLine);
  if (!dragged || dragged.kind !== "list-item" || dragged.depth === undefined) return null;

  // Locate the target block.
  const target = blocks.find(
    (b) => b.toLine === drag.toLine || b.fromLine === drag.toLine
  ) ?? blocks.find((b) => drag.toLine >= b.fromLine && drag.toLine <= b.toLine);
  if (!target || target.kind !== "list-item" || target.depth === undefined) return null;

  // Compute the subtree: dragged item + all consecutive deeper-depth list items.
  const subtree: Block[] = [dragged];
  const draggedIdx = blocks.indexOf(dragged);
  for (let j = draggedIdx + 1; j < blocks.length; j++) {
    const next = blocks[j];
    if (next.kind !== "list-item") break;
    if ((next.depth ?? 0) <= (dragged.depth ?? 0)) break;
    subtree.push(next);
  }

  // Reject dragging into own descendant.
  if (subtree.some((b) => b.fromLine === target.fromLine)) return null;

  // Compute new depth.
  let newDepth: number;
  if (drag.position === "child") {
    newDepth = (target.depth ?? 0) + 1;
  } else {
    newDepth = target.depth ?? 0;
  }
  if (newDepth < 0) newDepth = 0;
  const depthDelta = newDepth - (dragged.depth ?? 0);

  // Re-indent every line in the subtree by the delta.
  const subtreeLines: string[] = [];
  for (const blk of subtree) {
    for (let ln = blk.fromLine; ln <= blk.toLine; ln++) {
      subtreeLines.push(reindentLine(lines[ln], depthDelta));
    }
  }

  // Determine the insertion point (as a line index in the ORIGINAL doc).
  // We need to splice subtree out first, then insert at the adjusted target.
  // To avoid index drift, work on a fresh line array with the subtree removed.
  const subtreeLineSet = new Set<number>();
  for (const blk of subtree) {
    for (let ln = blk.fromLine; ln <= blk.toLine; ln++) subtreeLineSet.add(ln);
  }
  const remaining: { line: string; origLine: number }[] = [];
  for (let ln = 0; ln < lines.length; ln++) {
    if (!subtreeLineSet.has(ln)) {
      remaining.push({ line: lines[ln], origLine: ln });
    }
  }

  // Find insertion index in `remaining` based on the target.
  let insertIdx: number;
  if (drag.position === "before") {
    insertIdx = remaining.findIndex((r) => r.origLine === target.fromLine);
  } else if (drag.position === "after") {
    // After the target's last line (target is single-line for list items, but
    // be safe and use toLine).
    const targetLast = target.toLine;
    insertIdx = remaining.findIndex((r) => r.origLine === targetLast);
    if (insertIdx !== -1) insertIdx += 1;
  } else {
    // child: insert immediately after the target's last line.
    const targetLast = target.toLine;
    insertIdx = remaining.findIndex((r) => r.origLine === targetLast);
    if (insertIdx !== -1) insertIdx += 1;
  }
  if (insertIdx === -1) insertIdx = remaining.length;

  // Build the new line array.
  const newLines: string[] = [
    ...remaining.slice(0, insertIdx).map((r) => r.line),
    ...subtreeLines,
    ...remaining.slice(insertIdx).map((r) => r.line),
  ];

  // Compute the new fromLine of the dragged item (first subtree line).
  const newFromLine = insertIdx;

  return {
    text: newLines.join("\n"),
    newFromLine,
  };
}

/**
 * Re-indent a single line by a depth delta. Preserves the marker and content,
 * only changes the leading indent. For non-list lines (continuations), scales
 * the indent proportionally (rounded to the nearest depth unit).
 */
function reindentLine(line: string, depthDelta: number): string {
  if (depthDelta === 0) return line;
  const match = /^(\s*)(.*)$/.exec(line);
  if (!match) return line;
  const oldIndent = match[1];
  const rest = match[2];
  // Count the old depth, add delta, clamp at 0.
  const oldDepth = countDepthFromIndent(oldIndent);
  const newDepth = Math.max(0, oldDepth + depthDelta);
  return indentForDepth(newDepth) + rest;
}

function countDepthFromIndent(indent: string): number {
  let depth = 0;
  let spaces = 0;
  for (const ch of indent) {
    if (ch === "\t") {
      depth += 2;
      spaces = 0;
    } else {
      spaces++;
      if (spaces >= 2) {
        depth++;
        spaces = 0;
      }
    }
  }
  return depth;
}

/** Indent the current line (or selected list item) by one level. */
export function indentItem(text: string, line: number): string | null {
  return shiftItem(text, line, +1);
}

/** Outdent the current line (or selected list item) by one level. */
export function outdentItem(text: string, line: number): string | null {
  return shiftItem(text, line, -1);
}

function shiftItem(text: string, line: number, delta: number): string | null {
  const blocks = deriveBlocks(text);
  const blk = blocks.find((b) => line >= b.fromLine && line <= b.toLine && b.kind === "list-item");
  if (!blk || blk.depth === undefined) return null;
  const newDepth = Math.max(0, blk.depth + delta);
  if (newDepth === blk.depth) return null;
  const lines = text.split("\n");
  // Re-indent this item only (not children — manual indent/outdent is per-item).
  const lineText = lines[line];
  const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lineText);
  if (!m) return null;
  lines[line] = indentForDepth(newDepth) + m[2] + " " + m[3];
  return lines.join("\n");
}
