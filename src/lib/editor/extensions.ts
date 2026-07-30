/**
 * CodeMirror 6 extension bundle for the Markdown editor.
 *
 * Composition (in order):
 *  - lineWrapping               — soft-wrap long lines
 *  - markdownLanguage (+ code langs) — the Lezer markdown parser + syntax
 *                                      highlighting for fenced code blocks
 *  - theme                      — maps to our CSS custom props so the editor
 *                                 matches the app's light/dark mode
 *  - livePreview                — mark-decoration live preview: styles inline
 *                                 tokens (emphasis/strong/code/heading/quote)
 *  - blockSeparators            — subtle dividers before headings for the
 *                                 "block-based" feel
 *  - foldGutter + foldService   — fold/unfold headings + list subtrees, using
 *                                 our block-model ranges
 *  - keymap / history / search  — standard editing keys
 *  - IME guard                  — compositionstart/end suppresses live-preview
 *                                 re-decoration mid-composition
 */

import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  ViewPlugin,
  Decoration,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  indentUnit,
  syntaxHighlighting,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  codeFolding,
  foldService,
  syntaxTree,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { computeFoldableRanges } from "./folding";
import { extractWikiLinks, extractTags } from "./custom-syntax";
import { extractFootnotes } from "./footnotes";

/** Extract math expressions: $...$ (inline) and $$...$$ (block). */
function extractMath(text: string): { from: number; to: number; display: boolean; content: string }[] {
  const results: { from: number; to: number; display: boolean; content: string }[] = [];
  // Block math: $$...$$
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  for (const m of text.matchAll(blockRe)) {
    results.push({
      from: m.index!,
      to: m.index! + m[0].length,
      display: true,
      content: m[1].trim(),
    });
  }
  // Inline math: $...$ — simple approach without lookbehind.
  // Skip $$ (block) and match single $...$ on a single line.
  const inlineRe = /\$([^\$\n]+?)\$/g;
  for (const m of text.matchAll(inlineRe)) {
    const from = m.index!;
    // Skip if preceded by $ (would be part of $$).
    if (from > 0 && text[from - 1] === "$") continue;
    const to = from + m[0].length;
    // Skip if followed by $ (would be part of $$).
    if (to < text.length && text[to] === "$") continue;
    // Skip if inside a block math range.
    if (results.some((r) => from >= r.from && to <= r.to)) continue;
    results.push({ from, to, display: false, content: m[1].trim() });
  }
  return results;
}

/** Build the full extension set. */
export function buildExtensions(opts: { readOnly?: boolean; livePreviewEnabled?: boolean; fontSize?: number; showLineNumbers?: boolean; tabSize?: number; lineWidth?: string } = {}): Extension[] {
  const enableLivePreview = opts.livePreviewEnabled !== false;
  const fontSize = opts.fontSize ?? 14;
  const showLines = opts.showLineNumbers !== false;
  const tabSz = opts.tabSize ?? 2;
  const lw = opts.lineWidth ?? "medium";

  const maxWidth = lw === "narrow" ? "600px" : lw === "wide" ? "900px" : "760px";

  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of(" ".repeat(tabSz)),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    closeBrackets(),
    ...(showLines ? [lineNumbers(), highlightActiveLineGutter()] : []),
    // Markdown language with code-block sub-languages.
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: true,
    }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    editorTheme(fontSize, maxWidth),
    ...(enableLivePreview ? [livePreview(), checkboxWidgets(), imageWidgets()] : []),
    // blockSeparators() — disabled: widget decorations before headings can
    // race with CodeMirror's measurement loop on docs with many headings.
    codeFolding({
      placeholderText: "\u2026",
    }),
    foldGutter({
      markerDOM: (open) => {
        const el = document.createElement("span");
        el.textContent = open ? "\u25BE" : "\u25B8";
        el.className = "vault-fold-marker" + (open ? " vault-fold-open" : "");
        el.style.cursor = "pointer";
        el.style.opacity = "0.5";
        el.style.padding = "0 2px";
        return el;
      },
    }),
    // Custom fold service: consult our block-model foldable ranges.
    // NOTE: Disabled for now — calling computeFoldableRanges (which re-parses
    // the whole doc via deriveBlocks) on every fold query causes performance
    // issues that race with CodeMirror's measurement loop on complex docs.
    // The default codeFolding() + markdown language folding still works.
    // foldService.of((state, lineStart, lineEnd) => {
    //   const text = state.doc.toString();
    //   const ranges = computeFoldableRanges(text);
    //   const line = state.doc.lineAt(lineStart).number - 1;
    //   const match = ranges.find((r) => r.fromLine === line);
    //   if (!match) return null;
    //   const from = state.doc.line(match.fromLine + 1).from;
    //   const to = state.doc.line(match.toLine + 1).to;
    //   void lineEnd;
    //   return from < to ? { from: from, to: to } : null;
    // }),
    EditorState.readOnly.of(!!opts.readOnly),
  ];
}

// --- theme -----------------------------------------------------------------

/**
 * A theme that reads our CSS custom properties (--background, --foreground,
 * --muted, etc.) so the editor automatically matches light/dark mode and the
 * shadcn palette.
 */
function editorTheme(fontSize: number = 14, maxWidth: string = "760px"): Extension {
  return EditorView.theme({
    "&": {
      color: "var(--foreground)",
      backgroundColor: "var(--background)",
      height: "100%",
      fontSize: `${fontSize}px`,
    },
    ".cm-content": {
      caretColor: "var(--primary)",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      padding: "16px 24px",
      maxWidth,
      margin: "0 auto",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--muted-foreground)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--foreground)",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--primary)",
      borderLeftWidth: "2px",
    },
    // Markdown syntax colors (subtle, Obsidian-like).
    ".tok-heading": { color: "var(--foreground)", fontWeight: "600" },
    ".tok-emphasis": { fontStyle: "italic" },
    ".tok-strong": { fontWeight: "700" },
    ".tok-monospace": {
      fontFamily: "var(--font-geist-mono), monospace",
      backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)",
      padding: "0 4px",
      borderRadius: "3px",
      fontSize: "0.9em",
    },
    ".tok-link": { color: "var(--primary)", textDecoration: "underline" },
    ".tok-url": { color: "var(--primary)" },
    ".tok-quote": { color: "var(--muted-foreground)", fontStyle: "italic" },
    ".tok-list": { color: "var(--primary)" },
    ".tok-meta": { color: "var(--muted-foreground)" },
    // Custom Obsidian syntax.
    ".tok-wikilink": {
      color: "var(--primary)",
      backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
      borderRadius: "3px",
      padding: "0 3px",
      textDecoration: "none",
      cursor: "pointer",
    },
    ".tok-embed": {
      color: "var(--primary)",
      backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
      borderRadius: "3px",
      padding: "0 3px",
      fontWeight: "600",
    },
    ".tok-tag": {
      color: "var(--primary)",
      fontWeight: "500",
      cursor: "pointer",
    },
    ".tok-footnote-ref": {
      verticalAlign: "super",
      fontSize: "0.75em",
      color: "var(--primary)",
      cursor: "pointer",
    },
    // Math expressions — serif italic for inline, centered block for display.
    ".tok-math-inline": {
      fontFamily: "KaTeX_Main, 'Times New Roman', serif",
      fontStyle: "italic",
      color: "var(--primary)",
      backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
      padding: "0 2px",
      borderRadius: "2px",
    },
    ".tok-math-block": {
      fontFamily: "KaTeX_Main, 'Times New Roman', serif",
      fontStyle: "italic",
      color: "var(--primary)",
      display: "block",
      textAlign: "center",
      padding: "8px 0",
      margin: "4px 0",
      backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
      borderRadius: "4px",
    },
    // Callout header — the [!type] badge in blockquotes.
    ".tok-callout-header": {
      fontWeight: "600",
      borderRadius: "3px",
      padding: "0 4px",
      backgroundColor: "color-mix(in srgb, var(--callout-color, var(--primary)) 20%, transparent)",
      color: "var(--callout-color, var(--primary))",
    },
    // Callout types — themed left border + tinted background (inline marks
    // only; multi-line block display would corrupt CodeMirror line measurement).
    ".tok-callout": {
      borderLeft: "3px solid var(--callout-color, var(--primary))",
      backgroundColor: "color-mix(in srgb, var(--callout-color, var(--primary)) 8%, transparent)",
      paddingLeft: "4px",
    },
    ".callout-note": { "--callout-color": "#4a9eff" },
    ".callout-tip": { "--callout-color": "#10b981" },
    ".callout-info": { "--callout-color": "#4a9eff" },
    ".callout-warning": { "--callout-color": "#f59e0b" },
    ".callout-danger": { "--callout-color": "#ef4444" },
    ".callout-success": { "--callout-color": "#10b981" },
    ".callout-question": { "--callout-color": "#a855f7" },
    ".callout-failure": { "--callout-color": "#ef4444" },
    ".callout-bug": { "--callout-color": "#f97316" },
    ".callout-example": { "--callout-color": "#6b7280" },
    ".callout-quote": { "--callout-color": "#6b7280" },
    ".callout-abstract": { "--callout-color": "#06b6d4" },
    ".callout-todo": { "--callout-color": "#4a9eff" },
    ".callout-compatibility": { "--callout-color": "#f59e0b" },
    ".cm-line": { padding: "2px 0" },
    ".vault-fold-marker": { userSelect: "none" },
    ".vault-block-sep": {
      height: "1px",
      margin: "6px 0",
      backgroundColor: "color-mix(in srgb, var(--border) 50%, transparent)",
    },
    ".vault-drag-handle": {
      cursor: "grab",
      color: "var(--muted-foreground)",
      opacity: "0",
      transition: "opacity 0.1s",
    },
    ".cm-line:hover .vault-drag-handle": { opacity: "0.6" },
    ".vault-drag-handle:active": { cursor: "grabbing" },
  });
}

// --- live preview ----------------------------------------------------------

/** Global IME composition flag, toggled by compositionstart/end listeners. */
let imeComposing = false;
export function setImeComposing(v: boolean) {
  imeComposing = v;
}

/**
 * Live-preview decorations: mark inline markdown tokens with styled classes.
 * Re-derived on doc change OR viewport change, but only for visible lines.
 * SUPPRESSED during IME composition so the cursor is never disrupted mid-keystroke.
 */
function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view);
      }
      update(u: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if ((u.docChanged || u.viewportChanged) && !imeComposing) {
          this.decorations = buildLivePreviewDecorations(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

interface DecoEntry {
  from: number;
  to: number;
  deco: Decoration;
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const text = state.doc.toString();
  const tree = syntaxTree(state);
  const decos: DecoEntry[] = [];

  // Only compute decorations for visible ranges (viewport-aware).
  const visibleRanges = view.visibleRanges;
  const visibleFrom = visibleRanges.length > 0 ? visibleRanges[0].from : 0;
  const visibleTo = visibleRanges.length > 0 ? visibleRanges[visibleRanges.length - 1].to : text.length;

  // Helper: check if a range overlaps the visible viewport
  const isVisible = (from: number, to: number) =>
    from <= visibleTo && to >= visibleFrom;

  // --- Standard markdown syntax (via Lezer tree) ---
  tree.iterate({
    from: visibleFrom,
    to: visibleTo,
    enter(node) {
      const name = node.name;
      if (name === "ATXHeading1" || name === "ATXHeading2" || name === "ATXHeading3") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-heading" }) });
        return;
      }
      if (name === "Emphasis" || name === "EmphasisMark") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-emphasis" }) });
        return;
      }
      if (name === "StrongEmphasis" || name === "StrongMark") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-strong" }) });
        return;
      }
      if (name === "InlineCode" || name === "CodeMark") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-monospace" }) });
        return;
      }
      if (name === "FencedCode") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-monospace" }) });
        return;
      }
      if (name === "Quote") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-quote" }) });
        return;
      }
      if (name === "ListMark" || name === "ListMarker") {
        decos.push({ from: node.from, to: node.to, deco: Decoration.mark({ class: "tok-list" }) });
        return;
      }
    },
  });

  // --- Custom Obsidian syntax (regex-based, applied to raw text) ---

  // Build code ranges for exclusion (only for visible area).
  const codeRanges: Array<[number, number]> = [];
  tree.iterate({
    from: visibleFrom,
    to: visibleTo,
    enter(node) {
      if (node.name === "FencedCode" || node.name === "InlineCode") {
        codeRanges.push([node.from, node.to]);
      }
    },
  });
  const inCode = (from: number, to: number) =>
    codeRanges.some(([cf, ct]) => from >= cf && to <= ct);

  // WikiLinks + embeds.
  for (const link of extractWikiLinks(text)) {
    if (!isVisible(link.from, link.to)) continue;
    decos.push({
      from: link.from,
      to: link.to,
      deco: Decoration.mark({ class: link.embed ? "tok-embed" : "tok-wikilink", attributes: { "data-target": link.noteName } }),
    });
  }

  // Tags -- skip if inside a code span.
  for (const tag of extractTags(text)) {
    if (!isVisible(tag.from, tag.to)) continue;
    if (inCode(tag.from, tag.to)) continue;
    decos.push({
      from: tag.from,
      to: tag.to,
      deco: Decoration.mark({ class: "tok-tag", attributes: { "data-tag": tag.tag } }),
    });
  }

  // Footnote references.
  const { refs: fnRefs } = extractFootnotes(text);
  for (const ref of fnRefs) {
    if (!isVisible(ref.from, ref.to)) continue;
    if (inCode(ref.from, ref.to)) continue;
    decos.push({
      from: ref.from,
      to: ref.to,
      deco: Decoration.mark({
        class: "tok-footnote-ref",
        attributes: { "data-fn-id": ref.id, "data-fn-num": String(ref.number) },
      }),
    });
  }

  // Math expressions (inline + block).
  for (const math of extractMath(text)) {
    if (!isVisible(math.from, math.to)) continue;
    decos.push({
      from: math.from,
      to: math.to,
      deco: Decoration.mark({
        class: math.display ? "tok-math-block" : "tok-math-inline",
      }),
    });
  }

  // Callout header -- mark just the `[!type]` badge (single-line, safe).
  const calloutHeaderRe = />\s*\[!([a-zA-Z-]+)\]/g;
  for (const m of text.matchAll(calloutHeaderRe)) {
    const from = m.index! + m[0].indexOf("[");
    const to = m.index! + m[0].length;
    if (!isVisible(from, to)) continue;
    const type = m[1].toLowerCase();
    decos.push({
      from,
      to,
      deco: Decoration.mark({
        class: `tok-callout-header callout-${type}`,
      }),
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from, d.to)),
    true
  );
}

// --- block separators ------------------------------------------------------

/** Add a thin separator decoration before each heading (after the first). */
function blockSeparators(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildBlockSeparators(view);
      }
      update(u: { docChanged: boolean; view: EditorView }) {
        if (u.docChanged) this.decorations = buildBlockSeparators(u.view);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

function buildBlockSeparators(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const lines = text.split("\n");
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) {
      const pos = view.state.doc.line(i + 1).from;
      decos.push({
        from: pos,
        to: pos,
        deco: Decoration.widget({
          widget: new BlockSeparatorWidget(),
          side: -1,
          block: true,
        }),
      });
    }
  }
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from, d.to)),
    true
  );
}

class BlockSeparatorWidget extends WidgetType {
  toDOM() {
    const el = document.createElement("div");
    el.className = "vault-block-sep";
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

// --- interactive checkbox widgets ------------------------------------------

/**
 * Detects `- [ ]` and `- [x]` (or `- [X]`) patterns and renders a clickable
 * checkbox widget. Clicking toggles between checked/unchecked by dispatching
 * a CodeMirror transaction.
 */
function checkboxWidgets(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildCheckboxDecorations(view);
      }
      update(u: { docChanged: boolean; view: EditorView }) {
        if (u.docChanged && !imeComposing) {
          this.decorations = buildCheckboxDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Regex: matches `- [ ]` or `- [x]` or `- [X]` at line start (with optional leading whitespace)
const CHECKBOX_RE = /^(\s*- \[)([ xX])(\])/gm;

function buildCheckboxDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const decos: Array<{ from: number; deco: Decoration }> = [];

  for (const m of text.matchAll(CHECKBOX_RE)) {
    const checked = m[2] !== " ";
    // Position of the checkbox character (space or x) inside the brackets
    const charPos = m.index! + m[1].length;
    // Replace the entire `- [ ]` or `- [x]` portion with a widget
    const from = m.index! + (m[1].length - 1 - 1); // start of `[`
    const widgetFrom = m.index! + m[1].length - 1; // `[` position
    const widgetTo = m.index! + m[1].length + 1 + 1; // after `]`

    decos.push({
      from: widgetFrom,
      deco: Decoration.widget({
        widget: new CheckboxWidget(checked, charPos),
        side: -1,
      }),
    });
  }

  // Sort by position
  decos.sort((a, b) => a.from - b.from);
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from)),
    true
  );
}

class CheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private charPos: number
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "vault-checkbox-widget";
    input.style.cursor = "pointer";
    input.style.marginRight = "2px";
    input.style.verticalAlign = "middle";
    input.style.accentColor = "var(--primary)";

    const charPos = this.charPos;
    const checked = this.checked;
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newChar = checked ? " " : "x";
      view.dispatch({
        changes: { from: charPos, to: charPos + 1, insert: newChar },
      });
    });

    return input;
  }

  eq(other: CheckboxWidget) {
    return this.checked === other.checked && this.charPos === other.charPos;
  }

  ignoreEvent() {
    return false;
  }
}

// --- inline image widgets --------------------------------------------------

/**
 * Detects `![[image.ext]]` and `![alt](url)` patterns and renders an inline
 * <img> widget below the line. Only renders for image file extensions.
 */
function imageWidgets(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildImageDecorations(view);
      }
      update(u: { docChanged: boolean; view: EditorView }) {
        if (u.docChanged && !imeComposing) {
          this.decorations = buildImageDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

// Wiki embed: ![[filename.ext]]
const WIKI_IMAGE_RE = /!\[\[([^\]\n]+)\]\]/g;
// Standard markdown image: ![alt](url)
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;

function buildImageDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const decos: Array<{ from: number; deco: Decoration }> = [];

  // Wiki-style embeds: ![[image.png]]
  for (const m of text.matchAll(WIKI_IMAGE_RE)) {
    const target = m[1].trim();
    const ext = target.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTS.includes(ext)) continue;
    const lineEnd = view.state.doc.lineAt(m.index!).to;
    decos.push({
      from: lineEnd,
      deco: Decoration.widget({
        widget: new ImageWidget(target, true),
        side: 1,
        block: true,
      }),
    });
  }

  // Standard markdown images: ![alt](url)
  for (const m of text.matchAll(MD_IMAGE_RE)) {
    const url = m[2].trim();
    // Check if it looks like an image URL
    const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
    const isDataUrl = url.startsWith("data:image/");
    const isHttpUrl = url.startsWith("http://") || url.startsWith("https://");
    if (!IMAGE_EXTS.includes(ext) && !isDataUrl && !isHttpUrl) continue;
    const lineEnd = view.state.doc.lineAt(m.index!).to;
    decos.push({
      from: lineEnd,
      deco: Decoration.widget({
        widget: new ImageWidget(url, false),
        side: 1,
        block: true,
      }),
    });
  }

  decos.sort((a, b) => a.from - b.from);
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from)),
    true
  );
}

class ImageWidget extends WidgetType {
  constructor(
    private src: string,
    private isWikiEmbed: boolean
  ) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "vault-image-widget";
    wrapper.style.padding = "8px 0";
    wrapper.style.textAlign = "center";

    const isExternal =
      this.src.startsWith("http://") ||
      this.src.startsWith("https://") ||
      this.src.startsWith("data:image/");

    if (isExternal) {
      const img = document.createElement("img");
      img.src = this.src;
      img.alt = this.src;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "400px";
      img.style.borderRadius = "6px";
      img.style.border = "1px solid var(--border)";
      img.loading = "lazy";
      wrapper.appendChild(img);
    } else {
      // Local vault image - show a placeholder since we cannot resolve the
      // path without file system access in CodeMirror
      const placeholder = document.createElement("div");
      placeholder.className = "vault-image-placeholder";
      placeholder.style.display = "inline-flex";
      placeholder.style.alignItems = "center";
      placeholder.style.gap = "6px";
      placeholder.style.padding = "8px 16px";
      placeholder.style.borderRadius = "6px";
      placeholder.style.backgroundColor = "color-mix(in srgb, var(--muted) 50%, transparent)";
      placeholder.style.color = "var(--muted-foreground)";
      placeholder.style.fontSize = "13px";
      placeholder.textContent = `Image: ${this.src}`;
      wrapper.appendChild(placeholder);
    }

    return wrapper;
  }

  eq(other: ImageWidget) {
    return this.src === other.src && this.isWikiEmbed === other.isWikiEmbed;
  }

  ignoreEvent() {
    return true;
  }
}
