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
}

interface CodeMirrorEditorProps {
  /** Initial document text (seed only; use the handle to swap). */
  initialText: string;
  /** Fired on every doc change with the new text. */
  onChange: (text: string) => void;
  /** Read-only mode. */
  readOnly?: boolean;
  /** Fired when the user presses Cmd/Ctrl+S. */
  onSave?: () => void;
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
  function CodeMirrorEditor({ initialText, onChange, readOnly, onSave }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);

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
    }));

    useEffect(() => {
      onChangeRef.current = onChange;
      onSaveRef.current = onSave;
    });

    useEffect(() => {
      if (!hostRef.current || viewRef.current) return;

      const extensions: Extension[] = [
        EditorView.lineWrapping,
        ...buildExtensions({ readOnly }),
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
