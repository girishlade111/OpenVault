"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveFileId } from "@/store/vault-store";
import { useVaultStore } from "@/store/vault-store";
import { extractFootnotes, type FootnoteRef } from "@/lib/editor/footnotes";
import { cn } from "@/lib/utils";

/**
 * Footnote hover popover.
 *
 * Listens for mousemove over the CodeMirror editor. When the cursor is over a
 * `.tok-footnote-ref` span, renders a popover with the matching definition
 * text. Debounced 200ms to avoid flicker.
 */
export function FootnotePopover({ editorSelector }: { editorSelector: string }) {
  const [active, setActive] = useState<{
    ref: FootnoteRef;
    x: number;
    y: number;
  } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = document.querySelector(editorSelector);
    if (!editor) return;

    const handleMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest(".tok-footnote-ref") as HTMLElement | null;
      if (target) {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        const id = target.getAttribute("data-fn-id");
        if (!id) return;
        // Get the active file's content + footnotes.
        // We read from the store directly to avoid re-render churn.
        const state = useVaultStore.getState();
        const activeFileId = state.workspace?.activeLeafId
          ? // derive active file id
            ((): string | null => {
              const leaf = state.workspace!.root;
              const found = findLeafById(leaf, state.workspace!.activeLeafId);
              if (found?.view.kind !== "editor") return null;
              return found.view.activeTabId;
            })()
          : null;
        if (!activeFileId) return;
        const content = state.contentCache[activeFileId];
        if (content === undefined) return;
        const { refs } = extractFootnotes(content);
        const ref = refs.find((r) => r.id === id);
        if (!ref || !ref.definition) return;
        const rect = target.getBoundingClientRect();
        setActive({ ref, x: rect.left, y: rect.bottom + 4 });
      } else {
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => setActive(null), 200);
        }
      }
    };

    editor.addEventListener("mousemove", handleMove as EventListener);
    return () => {
      editor.removeEventListener("mousemove", handleMove as EventListener);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorSelector]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 max-w-sm bg-popover text-popover-foreground border rounded-md shadow-lg p-3 text-sm pointer-events-none"
      style={{ left: active.x, top: active.y }}
    >
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-[10px] font-mono text-muted-foreground">
          [{active.ref.id}]
        </span>
        <span className="text-[10px] text-muted-foreground">
          footnote #{active.ref.number}
        </span>
      </div>
      <p className="leading-relaxed">{active.ref.definition?.text}</p>
    </div>
  );
}

/** Recursively find a leaf by id in the workspace tree. */
function findLeafById(
  node: import("@/lib/workspace/types").WorkspaceNode,
  id: string
): import("@/lib/workspace/types").LeafNode | null {
  if (node.id === id) return node.type === "leaf" ? node : null;
  if (node.type !== "branch") return null;
  for (const c of node.children) {
    const r = findLeafById(c, id);
    if (r) return r;
  }
  return null;
}
