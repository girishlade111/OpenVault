"use client";

import { useEffect } from "react";
import { useVaultStore } from "@/store/vault-store";
import { isFsAccessSupported } from "@/lib/vault/fs";

/**
 * External-change detection.
 *
 * The File System Access API doesn't give us `fs.watch`-style recursive
 * notifications. We use two complementary mechanisms:
 *
 *  1. `FileSystemObserver` — a newer Chromium API (behind a flag in some
 *     versions) that delivers per-handle change records. When available we
 *     use it for near-realtime updates.
 *  2. `visibilitychange` + `focus` — when the tab regains focus we re-scan
 *     the vault. This catches the common case of a user editing a note in
 *     an external editor and returning to our app.
 *
 * Phase 1 implementation uses #2 unconditionally and #1 opportunistically.
 * Both paths funnel through `rescan()`, which is a no-op if a scan is
 * already running.
 */

// Minimal inline typing for the experimental FileSystemObserver API.
interface FsObserverChangeRecord {
  rootHandle: unknown;
  changedHandles: unknown[];
  type: "appeared" | "disappeared" | "modified";
}
interface FsObserverCtor {
  new (cb: (records: FsObserverChangeRecord[]) => void): {
    observe: (handle: unknown, opts?: { recursive?: boolean }) => Promise<void>;
    disconnect: () => void;
  };
}

export function useVaultWatcher() {
  const rescan = useVaultStore((s) => s.rescan);
  const handle = useVaultStore((s) => s.handle);
  const rootDirHandle = useVaultStore((s) => s.rootDirHandle);

  useEffect(() => {
    if (handle?.kind !== "fs-access" || !rootDirHandle) return;

    let observer: { disconnect: () => void; observe?: (handle: unknown, opts?: { recursive?: boolean }) => Promise<void> } | null = null;
    const ObserverCtor = (window as unknown as { FileSystemObserver?: FsObserverCtor })
      .FileSystemObserver;
    if (typeof ObserverCtor === "function") {
      try {
        observer = new ObserverCtor(() => {
          void rescan();
        });
        void observer.observe?.(rootDirHandle, { recursive: true }).catch(() => {
          // observer not actually supported at runtime — fall back to focus
        });
      } catch {
        observer = null;
      }
    }

    const onFocus = () => void rescan();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void rescan();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer?.disconnect();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [handle, rootDirHandle, rescan]);

  // Flag the watcher status as "unsupported" when running in demo mode so
  // the status bar communicates the in-memory nature clearly.
  const setStatus = useVaultStore.setState;
  useEffect(() => {
    if (handle?.kind === "demo") {
      setStatus({ watcherStatus: "watching" });
    } else if (!isFsAccessSupported() && handle === null) {
      // nothing yet
    }
  }, [handle, setStatus]);
}
