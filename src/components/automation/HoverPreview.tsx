"use client";

import { useEffect, useRef, useState } from "react";
import { useVaultStore } from "@/store/vault-store";
import { resolveLink, noteNameFromPath } from "@/lib/index/link-index";
import { useIndexStore } from "@/store/index-store";

/**
 * Hover Page Preview.
 *
 * When the user hovers over a `.tok-wikilink` span in the editor for >300ms,
 * this component resolves the link target to a file and shows a popover with
 * the first few lines of that note's content rendered as plain text (full
 * markdown rendering arrives in a later sprint).
 *
 * The popover is positioned below the link, debounced to avoid flicker, and
 * dismissed on mouseleave.
 */
export function HoverPreview({ editorSelector }: { editorSelector: string }) {
  const [active, setActive] = useState<{
    target: string;
    x: number;
    y: number;
    content: string;
    filePath: string;
  } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Poll for the editor element — it may mount after this component.
    let editor: Element | null = null;
    let pollCount = 0;
    const poll = () => {
      editor = document.querySelector(editorSelector);
      if (editor) {
        attachListener(editor as HTMLElement);
      } else if (pollCount < 20) {
        pollCount++;
        setTimeout(poll, 100);
      }
    };

    const handleMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest(".tok-wikilink") as HTMLElement | null;
      if (target) {
        const noteName = target.getAttribute("data-target");
        if (!noteName) return;

        // Clear any pending hide.
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }

        // Debounce the show.
        if (showTimerRef.current) clearTimeout(showTimerRef.current);
        showTimerRef.current = setTimeout(() => {
          const state = useVaultStore.getState();
          const index = useIndexStore.getState().index;
          if (!state.manifest || !index) return;

          const fileId = resolveLink(noteName, index.nameIndex, state.manifest);
          if (!fileId) return;
          const content = state.contentCache[fileId];
          if (content === undefined) return;
          const node = state.manifest.nodes[fileId];
          if (!node) return;

          const rect = target.getBoundingClientRect();
          setActive({
            target: noteName,
            x: rect.left,
            y: rect.bottom + 4,
            content: content.slice(0, 500),
            filePath: node.path,
          });
        }, 300);
      } else {
        // Clear any pending show.
        if (showTimerRef.current) {
          clearTimeout(showTimerRef.current);
          showTimerRef.current = null;
        }
        // Debounce the hide.
        if (!hideTimerRef.current) {
          hideTimerRef.current = setTimeout(() => setActive(null), 200);
        }
      }
    };

    const attachListener = (ed: HTMLElement) => {
      ed.addEventListener("mousemove", handleMove);
    };

    poll();

    return () => {
      const ed = document.querySelector(editorSelector) as HTMLElement | null;
      ed?.removeEventListener("mousemove", handleMove);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [editorSelector]);

  if (!active) return null;

  return (
    <div
      className="fixed z-50 max-w-md bg-popover text-popover-foreground border rounded-md shadow-xl p-3 text-sm pointer-events-none"
      style={{ left: active.x, top: active.y }}
    >
      <div className="flex items-center gap-1.5 mb-2 pb-2 border-b">
        <FileText className="w-3.5 h-3.5 text-sky-500" />
        <span className="font-medium truncate">{noteNameFromPath(active.filePath)}</span>
        <span className="text-[10px] text-muted-foreground truncate">{active.filePath}</span>
      </div>
      <div className="max-h-64 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap font-mono">
        {active.content || "(empty note)"}
      </div>
    </div>
  );
}

function FileText({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}
