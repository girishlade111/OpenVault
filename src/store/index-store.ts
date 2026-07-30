/**
 * Index store (Zustand).
 *
 * Owns the bidirectional LinkIndex and orchestrates its lifecycle:
 *  • `buildIndex()` — full rebuild on vault open (cold start).
 *  • `reindexFile()` — incremental update on single-file edit (O(edges), not
 *    O(vault)).
 *  • `removeFile()` — clean up when a file is deleted.
 *
 * The store subscribes to the vault store's manifest + contentCache. When a
 * file's content changes, we debounce the re-index (300ms) so rapid keystrokes
 * don't thrash the index.
 *
 * Components subscribe via selectors:
 *  • `useBacklinks(fileId)` — incoming edges for a note.
 *  • `useOutgoingLinks(fileId)` — outgoing edges.
 *  • `useFilesByTag(tag)` — all files with a tag.
 *  • `useIndexStats()` — vault-wide graph stats.
 */

"use client";

import { create } from "zustand";
import type { FileId, VaultManifest } from "@/lib/vault/types";
import {
  buildLinkIndex,
  incrementalReindex,
  removeFileFromIndex,
  emptyLinkIndex,
  type LinkIndex,
  type LinkEdge,
} from "@/lib/index/link-index";
import {
  buildInvertedIndex,
  incrementalUpdateInverted,
  removeFileFromInverted,
  emptyInvertedIndex,
  type InvertedIndex,
} from "@/lib/search/inverted-index";

/** Stable empty array — avoids infinite re-renders in selectors that return []. */
const EMPTY_EDGES: LinkEdge[] = [];

interface IndexState {
  /** The active link index, or null before the vault opens. */
  index: LinkIndex | null;
  /** The inverted full-text index, or null before the vault opens. */
  inverted: InvertedIndex | null;
  /** True while a full rebuild is in progress. */
  building: boolean;
  /** Timestamp of the last incremental update. */
  lastUpdate: number;

  // --- actions ---
  buildIndex: (
    manifest: VaultManifest,
    contentCache: Record<FileId, string>
  ) => void;
  reindexFile: (
    fileId: FileId,
    content: string,
    manifest: VaultManifest
  ) => void;
  removeFile: (fileId: FileId) => void;
  clear: () => void;
}

// Debounce timers per file so rapid edits don't thrash.
const reindexTimers = new Map<FileId, ReturnType<typeof setTimeout>>();

export const useIndexStore = create<IndexState>((set, get) => ({
  index: null,
  inverted: null,
  building: false,
  lastUpdate: 0,

  buildIndex: (manifest, contentCache) => {
    set({ building: true });
    // Build synchronously — for typical vaults (< 1000 notes) this is fast
    // enough. For huge vaults, this could move to a Web Worker (Sprint 9).
    const index = buildLinkIndex(manifest, contentCache);
    // Build the inverted full-text index from all markdown files.
    const files: { fileId: FileId; content: string }[] = [];
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind === "file" && node.isMarkdown) {
        const content = contentCache[node.id];
        if (content !== undefined) files.push({ fileId: node.id, content });
      }
    }
    const inverted = buildInvertedIndex(files);
    set({ index, inverted, building: false, lastUpdate: Date.now() });
  },

  reindexFile: (fileId, content, manifest) => {
    const cur = get().index;
    if (!cur) return;
    // Debounce: collapse rapid edits into one re-index.
    // Use aggressive debounce (600ms) for large files to reduce thrashing.
    const debounceMs = content.length > 10240 ? 600 : 300;
    const existing = reindexTimers.get(fileId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      reindexTimers.delete(fileId);
      const current = get().index;
      const currentInverted = get().inverted;
      if (!current) return;
      const next = incrementalReindex(current, fileId, content, manifest);
      // Update the inverted index too.
      let nextInverted = currentInverted;
      if (currentInverted) {
        nextInverted = incrementalUpdateInverted(currentInverted, fileId, content);
      }
      // Create new object references so React subscribers re-render.
      set({
        index: {
          ...next,
          outgoing: new Map(next.outgoing),
          incoming: new Map(next.incoming),
          metadata: new Map(next.metadata),
          tagIndex: new Map(next.tagIndex),
        },
        inverted: nextInverted
          ? {
              ...nextInverted,
              postings: new Map(nextInverted.postings),
              docLengths: new Map(nextInverted.docLengths),
            }
          : null,
        lastUpdate: Date.now(),
      });
    }, debounceMs);
    reindexTimers.set(fileId, timer);
  },

  removeFile: (fileId) => {
    const cur = get().index;
    if (!cur) return;
    const next = removeFileFromIndex(cur, fileId);
    const currentInverted = get().inverted;
    if (currentInverted) removeFileFromInverted(currentInverted, fileId);
    set({
      index: {
        ...next,
        outgoing: new Map(next.outgoing),
        incoming: new Map(next.incoming),
        metadata: new Map(next.metadata),
        tagIndex: new Map(next.tagIndex),
      },
      inverted: currentInverted
        ? {
            ...currentInverted,
            postings: new Map(currentInverted.postings),
            docLengths: new Map(currentInverted.docLengths),
          }
        : null,
      lastUpdate: Date.now(),
    });
  },

  clear: () => {
    reindexTimers.forEach((t) => clearTimeout(t));
    reindexTimers.clear();
    set({ index: null, inverted: null, building: false, lastUpdate: 0 });
  },
}));

// --- selector hooks --------------------------------------------------------

/** Get backlinks (incoming edges) for a file. Reactively updates. */
export function useBacklinks(fileId: FileId | null): LinkEdge[] {
  return useIndexStore((s) => {
    if (!s.index || !fileId) return EMPTY_EDGES;
    return s.index.incoming.get(fileId) ?? EMPTY_EDGES;
  });
}

/** Get outgoing links from a file. Reactively updates. */
export function useOutgoingLinks(fileId: FileId | null): LinkEdge[] {
  return useIndexStore((s) => {
    if (!s.index || !fileId) return EMPTY_EDGES;
    return s.index.outgoing.get(fileId) ?? EMPTY_EDGES;
  });
}

/** Vault-wide index stats for the status bar / graph view. */
export function useIndexStats(): {
  totalNotes: number;
  totalLinks: number;
  totalTags: number;
  orphans: number;
} | null {
  // Subscribe to the index reference + lastUpdate so we recompute on changes.
  const index = useIndexStore((s) => s.index);
  const lastUpdate = useIndexStore((s) => s.lastUpdate);
  // Compute synchronously — the result is a fresh object but that's OK
  // because we only recompute when `index` or `lastUpdate` changes (not on
  // every render), thanks to the selector subscriptions above.
  if (!index) return null;
  let orphans = 0;
  for (const fileId of index.metadata.keys()) {
    const hasIncoming = (index.incoming.get(fileId)?.length ?? 0) > 0;
    const hasOutgoing = (index.outgoing.get(fileId)?.length ?? 0) > 0;
    if (!hasIncoming && !hasOutgoing) orphans++;
  }
  void lastUpdate;
  return {
    totalNotes: index.metadata.size,
    totalLinks: index.totalLinks,
    totalTags: index.allTags.length,
    orphans,
  };
}

/** Re-export for the bridge hook. */
export { emptyLinkIndex };
