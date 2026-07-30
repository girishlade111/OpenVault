"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildExtensions, setImeComposing } from "@/lib/editor/extensions";

export interface CodeMirrorHandle {
  /** Replace the entire document text. */
  setDoc: (text: string) => void;
  /** Get the current document text. */
  getDoc: () => string;
  /** Get the currently selected text (empty string if no selection). */
  getSelection: () => string;
  /** Wrap the current selection with a prefix and suffix (toggle behavior). */
  wrapSelection: (prefix: string, suffix: string) => void;
  /** Fold the block at the current cursor position. */
  foldAtCursor: () => void;
  /** Unfold the block at the current cursor position. */
  unfoldAtCursor: () => void;
}

interface CodeMirrorEditorProps {
  /** Initial document text (seed only; use the handle to swap). */
  initialText: string;
  /** Fired on every doc change with the new text. */
  onChange: (text: string) => void;
  /** Read-only mode. */
  readOnly?: boolean;
  /** Whether live-preview decorations are enabled (default true). */
  livePreviewEnabled?: boolean;
  /** Font size in pixels. */
  fontSize?: number;
  /** Whether to show line numbers. */
  showLineNumbers?: boolean;
  /** Tab/indent size. */
  tabSize?: number;
  /** Line width setting: narrow/medium/wide. */
  lineWidth?: string;
  /** Fired when the user presses Cmd/Ctrl+S. */
  onSave?: () => void;
  /** Fired when user Ctrl/Cmd+Clicks a wiki-link. */
  onWikiLinkClick?: (target: string) => void;
}

/**
 * React wrapper around CodeMirror 6.
 *
 * MOUNT-ONCE PATTERN: The EditorView is created once and NEVER destroyed
 * during the component's life (only on true unmount). The parent swaps
 * documents via the imperative handle (`setDoc`), which dispatches a
 * full-replace transaction. This avoids the "coordsAtPos undefined" crash
 * that occurs when the view is destroyed/recreated while CodeMirror's
 * measurement loop has a pending rAF.
 *
 * The `onChange` callback is deferred via Promise.resolve() so store updates
 * never run inside CodeMirror's update cycle.
 */
export const CodeMirrorEditor = forwardRef<CodeMirrorHandle, CodeMirrorEditorProps>(
  function CodeMirrorEditor({ initialText, onChange, readOnly, livePreviewEnabled, fontSize, showLineNumbers, tabSize, lineWidth, onSave, onWikiLinkClick }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    const onWikiLinkClickRef = useRef(onWikiLinkClick);

    useImperativeHandle(ref, () => ({
      setDoc: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const current = view.state.doc.toString();
        if (text === current) return;
        view.dispatch({
          changes: { from: 0, to: current.length, insert: text },
          annotations: [],
        });
      },
      getDoc: () => viewRef.current?.state.doc.toString() ?? "",
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return "";
        const { from, to } = view.state.selection.main;
        return view.state.sliceDoc(from, to);
      },
      wrapSelection: (prefix: string, suffix: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        // Toggle: if already wrapped, unwrap
        if (
          selected.startsWith(prefix) &&
          selected.endsWith(suffix) &&
          selected.length >= prefix.length + suffix.length
        ) {
          const inner = selected.slice(prefix.length, selected.length - suffix.length);
          view.dispatch({
            changes: { from, to, insert: inner },
            selection: { anchor: from, head: from + inner.length },
          });
        } else {
          const wrapped = `${prefix}${selected}${suffix}`;
          view.dispatch({
            changes: { from, to, insert: wrapped },
            selection: { anchor: from + prefix.length, head: from + prefix.length + selected.length },
          });
        }
        view.focus();
      },
      foldAtCursor: () => {
        const view = viewRef.current;
        if (!view) return;
        // Use CodeMirror's built-in fold command
        import("@codemirror/language").then(({ foldCode }) => {
          foldCode(view);
        });
      },
      unfoldAtCursor: () => {
        const view = viewRef.current;
        if (!view) return;
        import("@codemirror/language").then(({ unfoldCode }) => {
          unfoldCode(view);
        });
      },
    }));

    useEffect(() => {
      onChangeRef.current = onChange;
      onSaveRef.current = onSave;
      onWikiLinkClickRef.current = onWikiLinkClick;
    });

    useEffect(() => {
      if (!hostRef.current || viewRef.current) return;

      const extensions: Extension[] = [
        EditorView.lineWrapping,
        ...buildExtensions({ readOnly, livePreviewEnabled, fontSize, showLineNumbers, tabSize, lineWidth }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const text = u.state.doc.toString();
            Promise.resolve().then(() => onChangeRef.current(text));
          }
        }),
        EditorView.domEventHandlers({
          compositionstart: () => {
            setImeComposing(true);
            return false;
          },
          compositionend: () => {
            setImeComposing(false);
            return false;
          },
          keydown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              onSaveRef.current?.();
              return true;
            }
            return false;
          },
          click: (event) => {
            // Ctrl/Cmd+Click on wiki-links: navigate to the linked note
            if (!(event.metaKey || event.ctrlKey)) return false;
            const target = event.target as HTMLElement;
            const wikiEl = target.closest(".tok-wikilink");
            if (!wikiEl) return false;
            const linkTarget = wikiEl.getAttribute("data-target");
            if (linkTarget && onWikiLinkClickRef.current) {
              event.preventDefault();
              onWikiLinkClickRef.current(linkTarget);
              return true;
            }
            return false;
          },
        }),
      ];

      const state = EditorState.create({
        doc: initialText,
        extensions,
      });

      viewRef.current = new EditorView({
        state,
        parent: hostRef.current,
      });

      return () => {
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
        setImeComposing(false);
      };
    }, []);

    return (
      <div
        ref={hostRef}
        className="h-full w-full overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
      />
    );
  }
);
