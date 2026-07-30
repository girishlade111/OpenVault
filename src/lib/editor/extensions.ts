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
export function buildExtensions(opts: { readOnly?: boolean } = {}): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of("  "),
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
    lineNumbers(),
    highlightActiveLineGutter(),
    // Markdown language with code-block sub-languages.
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: true,
    }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    editorTheme(),
    livePreview(),
    // blockSeparators() — disabled: widget decorations before headings can
    // race with CodeMirror's measurement loop on docs with many headings.
    codeFolding({
      placeholderText: "…",
    }),
    foldGutter({
      markerDOM: (open) => {
        const el = document.createElement("span");
        el.textContent = open ? "▾" : "▸";
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
function editorTheme(): Extension {
  return EditorView.theme({
    "&": {
      color: "var(--foreground)",
      backgroundColor: "var(--background)",
      height: "100%",
      fontSize: "14px",
    },
    ".cm-content": {
      caretColor: "var(--primary)",
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      padding: "16px 24px",
      maxWidth: "760px",
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
 * Re-derived on every doc change, but SUPPRESSED during IME composition so
 * the cursor is never disrupted mid-keystroke.
 */
function livePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view);
      }
      update(u: { docChanged: boolean; view: EditorView }) {
        if (u.docChanged && !imeComposing) {
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

  // --- Standard markdown syntax (via Lezer tree) ---
  tree.iterate({
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

  // WikiLinks + embeds.
  for (const link of extractWikiLinks(text)) {
    decos.push({
      from: link.from,
      to: link.to,
      deco: Decoration.mark({ class: link.embed ? "tok-embed" : "tok-wikilink", attributes: { "data-target": link.noteName } }),
    });
  }

  // Tags — skip if inside a code span.
  const codeRanges: Array<[number, number]> = [];
  tree.iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "InlineCode") {
        codeRanges.push([node.from, node.to]);
      }
    },
  });
  const inCode = (from: number, to: number) =>
    codeRanges.some(([cf, ct]) => from >= cf && to <= ct);

  for (const tag of extractTags(text)) {
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
    decos.push({
      from: math.from,
      to: math.to,
      deco: Decoration.mark({
        class: math.display ? "tok-math-block" : "tok-math-inline",
      }),
    });
  }

  // Callout header — mark just the `[!type]` badge (single-line, safe).
  const calloutHeaderRe = />\s*\[!([a-zA-Z-]+)\]/g;
  for (const m of text.matchAll(calloutHeaderRe)) {
    const from = m.index! + m[0].indexOf("[");
    const to = m.index! + m[0].length;
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
