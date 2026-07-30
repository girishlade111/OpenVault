"use client";

import { useEffect, useRef } from "react";
import type { FileId, VaultManifest } from "@/lib/vault/types";
import { useVaultStore } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";

/**
 * Bridge hook: connects the vault store to the index store.
 *
 *  • When a vault opens (manifest becomes available), build the full index.
 *  • When a file's content changes in the cache, incrementally re-index that
 *    file (debounced inside the index store).
 *  • When the vault closes, clear the index.
 *
 * Mount this once at the top of VaultApp.
 */
export function useIndexBridge() {
  const manifest = useVaultStore((s) => s.manifest);
  const handle = useVaultStore((s) => s.handle);
  const contentCache = useVaultStore((s) => s.contentCache);
  const buildIndex = useIndexStore((s) => s.buildIndex);
  const reindexFile = useIndexStore((s) => s.reindexFile);
  const clear = useIndexStore((s) => s.clear);

  // Track which files we've already indexed (so we don't re-index the whole
  // vault on every contentCache change).
  const indexedFilesRef = useRef<Set<FileId>>(new Set());
  const lastBuiltManifestRef = useRef<VaultManifest | null>(null);

  // Full build when a new vault opens.
  useEffect(() => {
    if (!manifest || !handle) {
      clear();
      indexedFilesRef.current = new Set();
      lastBuiltManifestRef.current = null;
      return;
    }
    if (lastBuiltManifestRef.current === manifest) return;
    lastBuiltManifestRef.current = manifest;
    indexedFilesRef.current = new Set();
    buildIndex(manifest, contentCache);
    // Mark all indexed files.
    for (const id of Object.keys(manifest.nodes)) {
      const node = manifest.nodes[id];
      if (node.kind === "file" && node.isMarkdown && contentCache[id] !== undefined) {
        indexedFilesRef.current.add(id);
      }
    }
  }, [manifest, handle, contentCache, buildIndex, clear]);

  // Incremental re-index when a file's content changes.
  // We watch the contentCache object identity; the vault store replaces it on
  // every setContent, so this fires on every edit.
  const lastIndexRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!manifest) return;
    // For each markdown file, check if its content changed since last index.
    for (const id of indexedFilesRef.current) {
      const content = contentCache[id];
      if (content === undefined) continue;
      if (lastIndexRef.current[id] === content) continue;
      lastIndexRef.current[id] = content;
      reindexFile(id, content, manifest);
    }
  }, [contentCache, manifest, reindexFile]);
}
