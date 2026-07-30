"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, CircleAlert } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import type { FileId } from "@/lib/vault/types";
import { CodeMirrorEditor, type CodeMirrorHandle } from "./CodeMirrorEditor";
import { PropertiesPanel } from "./PropertiesPanel";
import { HoverPreview } from "@/components/automation/HoverPreview";
import { FootnotePopover } from "./FootnotePopover";
import { saveSnapshot } from "@/lib/history/snapshots";

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

/**
 * Loads a markdown file's text, mounts the CodeMirror 6 editor, and wires a
 * debounced autosave back to the vault.
 *
 * MOUNT-ONCE + IMPERATIVE DOC SWAP: The CodeMirrorEditor is mounted ONCE and
 * never unmounts during the pane's life. When `fileId` changes, we call
 * `editorRef.current.setDoc(newText)` to swap the document via a transaction.
 * This avoids the "coordsAtPos undefined" crash that occurs when the view is
 * destroyed/recreated while CodeMirror's measurement loop has a pending rAF.
 */
export function MarkdownEditorPane({ fileId }: { fileId: FileId }) {
  const ensureContent = useVaultStore((s) => s.ensureContent);
  const setContent = useVaultStore((s) => s.setContent);
  const handle = useVaultStore((s) => s.handle);
  const rootDirHandle = useVaultStore((s) => s.rootDirHandle);
  const manifest = useVaultStore((s) => s.manifest);
  const cachedText = useVaultStore((s) => s.contentCache[fileId]);

  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTextRef = useRef<string>("");
  const fileIdRef = useRef(fileId);
  fileIdRef.current = fileId;
  const editorRef = useRef<CodeMirrorHandle | null>(null);
  const lastSwappedFileRef = useRef<FileId | null>(null);
  const lastDispatchedTextRef = useRef<string>("");

  // Load content when fileId changes; swap the editor's doc imperatively.
  useEffect(() => {
    let cancelled = false;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void ensureContent(fileId).then((t) => {
      if (cancelled) return;
      const text = t ?? "";
      latestTextRef.current = text;
      lastDispatchedTextRef.current = text;
      // Swap the editor document imperatively (no remount). Use setTimeout to
      // ensure we're completely outside React's commit + CodeMirror's update
      // cycle.
      window.setTimeout(() => {
        if (cancelled) return;
        editorRef.current?.setDoc(text);
        lastSwappedFileRef.current = fileId;
      }, 0);
      setLoading(false);
      setSaveState("clean");
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, ensureContent]);

  // Debounced autosave.
  const scheduleSave = (newText: string) => {
    latestTextRef.current = newText;
    lastDispatchedTextRef.current = newText;
    setContent(fileIdRef.current, newText, true);
    setSaveState("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSave(newText);
    }, 800);
  };

  const doSave = async (textToSave: string) => {
    // Save a snapshot for version history (before the write).
    const node = manifest?.nodes[fileIdRef.current];
    if (node) {
      saveSnapshot(fileIdRef.current, node.name, textToSave, "auto-save");
    }

    if (handle?.kind === "demo") {
      setContent(fileIdRef.current, textToSave, false);
      setSaveState("saved");
      return;
    }
    if (!rootDirHandle || !manifest) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      if (!node || node.kind !== "file") throw new Error("File not in manifest");
      const { writeFileText } = await import("@/lib/vault/fs");
      await writeFileText(rootDirHandle, node.path, textToSave);
      setContent(fileIdRef.current, textToSave, false);
      setSaveState("saved");
      setTimeout(() => {
        setSaveState((s) => (s === "saved" ? "clean" : s));
      }, 1500);
    } catch {
      setSaveState("error");
    }
  };

  // Clear save timer on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  // Sync external content changes (e.g. Outline panel indent) into the editor,
  // but ONLY if the change didn't originate from the editor itself.
  useEffect(() => {
    if (cachedText === undefined) return;
    if (cachedText === lastDispatchedTextRef.current) return;
    lastDispatchedTextRef.current = cachedText;
    editorRef.current?.setDoc(cachedText);
  }, [cachedText]);

  if (loading && cachedText === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PropertiesPanel fileId={fileId} />
      <SaveIndicator state={saveState} />
      <div className="flex-1 min-h-0 relative" data-editor-host>
        <CodeMirrorEditor
          ref={editorRef}
          initialText={cachedText ?? ""}
          onChange={scheduleSave}
          onSave={() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            void doSave(latestTextRef.current);
          }}
        />
        <HoverPreview editorSelector="[data-editor-host] .cm-editor" />
        <FootnotePopover editorSelector="[data-editor-host] .cm-editor" />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === "dirty"
      ? "Editing…"
      : state === "saving"
      ? "Saving…"
      : state === "saved"
      ? "Saved"
      : state === "error"
      ? "Save failed"
      : "";
  if (!label) return null;
  return (
    <div className="absolute top-1 right-2 z-10 flex items-center gap-1 text-[10px] text-muted-foreground bg-background/80 backdrop-blur px-1.5 py-0.5 rounded">
      {state === "saving" && <Loader2 className="w-3 h-3 animate-spin" />}
      {state === "saved" && <Check className="w-3 h-3 text-emerald-500" />}
      {state === "error" && <CircleAlert className="w-3 h-3 text-destructive" />}
      {label}
    </div>
  );
}
