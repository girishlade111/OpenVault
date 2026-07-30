/**
 * Block data model.
 *
 * The document is treated as an ordered array of "Blocks" rather than a flat
 * string of lines. A block is the smallest structural unit a user can
 * manipulate as a whole — drag, fold, indent, outdent. Block types mirror the
 * structural elements of Markdown:
 *
 *   heading       — ATX heading (`# Title`)
 *   paragraph     — plain text paragraph
 *   list-item     — bullet or numbered list item (carries depth + ordered flag)
 *   code          — fenced code block
 *   blockquote    — `>` quote (possibly a callout in Sprint 4)
 *   thematic-rule — `---` horizontal rule
 *   frontmatter   — leading YAML `---` block
 *
 * Each block stores its line range (`from`/`to` line numbers), the raw text of
 * its first line (for identification), and type-specific metadata (heading
 * level, list depth, list marker, etc.). Block ids are STABLE across edits
 * within a session: they're derived from a hash of the block's content + its
 * ordinal position among siblings of the same kind. This lets the drag-drop
 * UI track a block across an indent change.
 *
 * Block derivation is a pure function of the document text — it does NOT touch
 * CodeMirror state. This keeps it testable and reusable (the outliner, the
 * fold computer, and Sprint 5's link indexer all consume blocks).
 */

/** Discriminated union of block kinds. */
export type BlockKind =
  | "frontmatter"
  | "heading"
  | "paragraph"
  | "list-item"
  | "code"
  | "blockquote"
  | "thematic-rule"
  | "blank";

export interface Block {
  /** Stable id within the document for the current session. */
  id: string;
  kind: BlockKind;
  /** Start line (0-based, inclusive). */
  fromLine: number;
  /** End line (0-based, inclusive). */
  toLine: number;
  /** First-line raw text (for tooltips / drag previews). */
  label: string;
  /** Heading level 1-6 (headings only). */
  level?: number;
  /** List-item indentation depth (0 = top level). */
  depth?: number;
  /** True for ordered lists (`1.`), false for bullets (`-`/`*`/`+`). */
  ordered?: boolean;
  /** The literal marker string (e.g. `-`, `*`, `1.`, `>`). */
  marker?: string;
  /** Indent string (spaces or tabs) prefixing the marker / content. */
  indent?: string;
}

const ATX_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)([.)])\s+(.*)$/;
const QUOTE_RE = /^(\s*)(>{1,})\s?(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const THEMATIC_RE = /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/;

/** Derive the ordered block list from a document string. */
export function deriveBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  // Leading YAML frontmatter.
  if (lines.length > 0 && lines[0].trim() === "---") {
    let end = -1;
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === "---" || lines[j].trim() === "...") {
        end = j;
        break;
      }
    }
    if (end > 0) {
      blocks.push(makeBlock("frontmatter", 0, end, lines.slice(0, end + 1).join("\n")));
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — collapse runs.
    if (line.trim() === "") {
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j++;
      blocks.push(makeBlock("blank", i, j - 1, ""));
      i = j;
      continue;
    }

    // Fenced code block.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const fenceMarker = fence[2][0];
      const fenceLen = fence[2].length;
      let j = i + 1;
      while (j < lines.length) {
        const close = new RegExp(`^${escapeRegex(fenceMarker)}{${fenceLen},}\\s*$`);
        if (close.test(lines[j])) {
          j++;
          break;
        }
        j++;
      }
      blocks.push(makeBlock("code", i, Math.min(j, lines.length) - 1, line, {
        marker: fence[2],
        indent: fence[1],
      }));
      i = j;
      continue;
    }

    // ATX heading.
    const heading = ATX_RE.exec(line);
    if (heading) {
      blocks.push(makeBlock("heading", i, i, line, { level: heading[1].length }));
      i++;
      continue;
    }

    // Thematic rule.
    if (THEMATIC_RE.test(line)) {
      blocks.push(makeBlock("thematic-rule", i, i, line));
      i++;
      continue;
    }

    // Blockquote (may span multiple consecutive `>` lines).
    if (QUOTE_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && QUOTE_RE.test(lines[j])) j++;
      blocks.push(makeBlock("blockquote", i, j - 1, line, {
        marker: ">",
      }));
      i = j;
      continue;
    }

    // List item — gather a run of consecutive list lines (bullets + ordered,
    // including indented continuation lines) as ONE block per item? No:
    // Obsidian treats each bullet as its own draggable block. We split per
    // item: an item ends at the next line that starts a new list marker OR a
    // blank line OR a dedent below the item's indent.
    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      const m = bullet ?? ordered!;
      const indent = m[1];
      const depth = countDepth(indent);
      const marker = bullet ? m[2] : `${m[2]}${m[3]}`;
      // A list item's block continues until: blank line followed by dedent,
      // or a new sibling marker at <= this indent, or a non-list non-blank
      // line at <= this indent. For simplicity (and to match outliner UX),
      // treat the item as a SINGLE line block; indented child items become
      // their own blocks. This keeps drag-drop semantics clean.
      blocks.push(makeBlock("list-item", i, i, line, {
        depth,
        ordered: !!ordered,
        marker,
        indent,
      }));
      i++;
      continue;
    }

    // Default: paragraph — gather consecutive non-blank, non-special lines.
    let j = i + 1;
    while (
      j < lines.length &&
      lines[j].trim() !== "" &&
      !ATX_RE.test(lines[j]) &&
      !FENCE_RE.test(lines[j]) &&
      !THEMATIC_RE.test(lines[j]) &&
      !BULLET_RE.test(lines[j]) &&
      !ORDERED_RE.test(lines[j]) &&
      !QUOTE_RE.test(lines[j])
    ) {
      j++;
    }
    blocks.push(makeBlock("paragraph", i, j - 1, lines.slice(i, j).join("\n")));
    i = j;
  }

  return blocks;
}

function makeBlock(
  kind: BlockKind,
  fromLine: number,
  toLine: number,
  label: string,
  extra: Partial<Block> = {}
): Block {
  const id = `${kind}:${fromLine}:${hash(label).toString(36)}`;
  return { id, kind, fromLine, toLine, label, ...extra };
}

/** Convert an indent string (spaces/tabs) to a numeric depth. Tab = 4, 2 spaces = 1 level. */
export function countDepth(indent: string): number {
  let depth = 0;
  let spaces = 0;
  for (const ch of indent) {
    if (ch === "\t") {
      depth += Math.ceil((spaces + 4) / 2);
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

/** Produce an indent string for a given depth (2 spaces per level by default). */
export function indentForDepth(depth: number, unit = "  "): string {
  return unit.repeat(Math.max(0, depth));
}

/** Compute the new indent string when moving an item from oldDepth to newDepth. */
export function reindent(line: string, oldDepth: number, newDepth: number): string {
  const oldIndent = indentForDepth(oldDepth);
  const newIndent = indentForDepth(newDepth);
  if (line.startsWith(oldIndent)) {
    return newIndent + line.slice(oldIndent.length);
  }
  // Fallback: replace leading whitespace.
  return newIndent + line.replace(/^\s*/, "");
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find the block containing a given line number (0-based). Returns null if none. */
export function blockAtLine(blocks: Block[], line: number): Block | null {
  for (const b of blocks) {
    if (line >= b.fromLine && line <= b.toLine) return b;
  }
  return null;
}

/**
 * Find all list-item blocks that are "children" of the given item — i.e.
 * consecutive following list items with greater depth. Used by the outliner
 * drag logic to move a subtree together.
 */
export function listChildren(blocks: Block[], item: Block): Block[] {
  if (item.kind !== "list-item") return [];
  const idx = blocks.indexOf(item);
  if (idx === -1) return [];
  const children: Block[] = [];
  for (let j = idx + 1; j < blocks.length; j++) {
    const next = blocks[j];
    if (next.kind !== "list-item") break;
    if ((next.depth ?? 0) <= (item.depth ?? 0)) break;
    children.push(next);
  }
  return children;
}
