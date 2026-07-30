/**
 * Callout / admonition parser.
 *
 * Obsidian callouts are blockquotes whose first line starts with `[!type]`,
 * optionally followed by a title, and optionally foldable (`[!type]+` /
 * `[!type]-`). Examples:
 *
 *   > [!note] Title here
 *   > Body line 1
 *   > Body line 2
 *
 *   > [!warning]- Foldable collapsed
 *   > Hidden until clicked
 *
 * Types map to CSS classes (note/tip/warning/danger/info/quote/example/...)
 * for themed rendering. Foldable callouts get a caret toggle.
 */

export type CalloutType =
  | "note"
  | "tip"
  | "info"
  | "todo"
  | "abstract"
  | "success"
  | "question"
  | "warning"
  | "failure"
  | "danger"
  | "bug"
  | "example"
  | "quote"
  | "compatibility"
  | string; // allow custom types

export interface Callout {
  /** Character offset of the opening `>` of the callout's first line. */
  from: number;
  /** Character offset after the callout's last line (including its newline). */
  to: number;
  /** 0-based start line. */
  fromLine: number;
  /** 0-based end line (inclusive). */
  toLine: number;
  type: CalloutType;
  /** Display title (the text after `[!type]` on the first line, or null). */
  title: string | null;
  /** True if foldable. `+` = default open, `-` = default collapsed. */
  foldable: boolean;
  defaultCollapsed: boolean;
  /** The body text (lines after the first, with `>` stripped). */
  body: string;
}

const CALLOUT_HEADER_RE = /^>\s*\[!([a-zA-Z-]+)\]([+-]?)(.*)$/;

/** Extract all callouts from the document text. */
export function extractCallouts(text: string): Callout[] {
  const lines = text.split("\n");
  const callouts: Callout[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = CALLOUT_HEADER_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const type = m[1].toLowerCase();
    const foldMarker = m[2];
    const title = m[3].trim() || null;
    const foldable = foldMarker === "+" || foldMarker === "-";
    const defaultCollapsed = foldMarker === "-";
    const fromLine = i;
    const from = lineStartOffset(text, fromLine);
    // Gather consecutive `>` lines.
    let j = i + 1;
    while (j < lines.length && /^>\s?/.test(lines[j])) j++;
    const toLine = j - 1;
    // Body = lines after the header, `>` stripped.
    const bodyLines: string[] = [];
    for (let k = i + 1; k <= toLine; k++) {
      bodyLines.push(lines[k].replace(/^>\s?/, ""));
    }
    const to = lineStartOffset(text, toLine) + lines[toLine].length + 1; // +1 for newline
    callouts.push({
      from,
      to: Math.min(to, text.length),
      fromLine,
      toLine,
      type,
      title,
      foldable,
      defaultCollapsed,
      body: bodyLines.join("\n"),
    });
    i = j;
  }
  return callouts;
}

/** Convert a 0-based line index to its character offset in the text. */
function lineStartOffset(text: string, line: number): number {
  if (line === 0) return 0;
  let offset = 0;
  let cur = 0;
  for (let i = 0; i < line; i++) {
    const nl = text.indexOf("\n", offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
    cur = offset;
  }
  return cur;
}

/** Map a callout type to an icon + color class for rendering. */
export function calloutStyle(type: CalloutType): { icon: string; colorClass: string; label: string } {
  const styles: Record<string, { icon: string; colorClass: string; label: string }> = {
    note: { icon: "ℹ", colorClass: "callout-note", label: "Note" },
    tip: { icon: "💡", colorClass: "callout-tip", label: "Tip" },
    info: { icon: "ℹ", colorClass: "callout-info", label: "Info" },
    todo: { icon: "✔", colorClass: "callout-todo", label: "To-do" },
    abstract: { icon: "📋", colorClass: "callout-abstract", label: "Abstract" },
    success: { icon: "✓", colorClass: "callout-success", label: "Success" },
    question: { icon: "?", colorClass: "callout-question", label: "Question" },
    warning: { icon: "⚠", colorClass: "callout-warning", label: "Warning" },
    failure: { icon: "✕", colorClass: "callout-failure", label: "Failure" },
    danger: { icon: "⚡", colorClass: "callout-danger", label: "Danger" },
    bug: { icon: "🐛", colorClass: "callout-bug", label: "Bug" },
    example: { icon: "📋", colorClass: "callout-example", label: "Example" },
    quote: { icon: "❝", colorClass: "callout-quote", label: "Quote" },
  };
  return styles[type] ?? { icon: "ℹ", colorClass: "callout-note", label: type };
}
