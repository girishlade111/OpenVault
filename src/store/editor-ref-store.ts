"use client";

/**
 * A simple store that keeps a reference to the active editor's imperative handle.
 * Commands use this to perform formatting operations on the focused editor.
 *
 * We use a plain module-level variable (not Zustand) because:
 *  - There's no need to re-render on ref changes
 *  - The ref is only consumed imperatively by command handlers
 */

import type { CodeMirrorHandle } from "@/components/editor/CodeMirrorEditor";

let activeEditorRef: CodeMirrorHandle | null = null;

/** Called by MarkdownEditorPane when the editor gains focus / becomes active. */
export function setActiveEditorRef(ref: CodeMirrorHandle | null): void {
  activeEditorRef = ref;
}

/** Used by command handlers to get the current editor handle. */
export function getActiveEditorRef(): CodeMirrorHandle | null {
  return activeEditorRef;
}
