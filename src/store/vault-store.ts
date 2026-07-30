/**
 * Centralized vault store (Zustand).
 *
 * Owns:
 *  • the active vault handle + manifest
 *  • the WORKSPACE TREE (Sprint 1): recursive Branch/Leaf nodes hosting
 *    editor views. Each editor leaf owns its own tab set. Multiple leaves
 *    can show different notes simultaneously.
 *  • the in-memory content cache (fileId → text)
 *  • sidebar collapse state and watcher status
 *
 * The workspace tree is persisted (debounced) to `.vault/workspace.json`
 * (FSA vaults) or localStorage (demo vault) and reconciled against the
 * manifest on load so externally-deleted files drop cleanly.
 *
 * NOT in this store (yet): link index (Sprint 5), graph layout (Sprint 8),
 * command palette (Sprint 6). Each gets its own slice/store.
 */

"use client";

import { create } from "zustand";
import type {
  FileId,
  VaultHandle,
  VaultManifest,
} from "@/lib/vault/types";
import {
  isFsAccessSupported,
  pickVaultDirectory,
  verifyPermission,
  persistRootHandle,
  loadPersistedRootHandle,
  clearPersistedRootHandle,
  type FsDirHandle,
} from "@/lib/vault/fs";
import { walkVault } from "@/lib/vault/walker";
import { buildDemoContent, buildDemoManifest } from "@/lib/vault/demo";
import {
  closeLeaf as treeCloseLeaf,
  closeTabInLeaf,
  createDefaultWorkspace,
  findLeaf,
  listLeaves,
  openFileInLeaf,
  setActiveTabInLeaf,
  setLeafCursor,
  setLeafScroll,
  splitLeaf,
  togglePinTabInLeaf,
  updateLeafView,
} from "@/lib/workspace/tree";
import {
  clearWorkspace,
  defaultWorkspaceForManifest,
  loadWorkspace,
  reconcile,
  saveWorkspace,
} from "@/lib/workspace/persist";
import type {
  EditorTab,
  NodeId,
  WorkspaceSnapshot,
  WorkspaceState,
} from "@/lib/workspace/types";

export type { EditorTab } from "@/lib/workspace/types";

export type WatcherStatus = "idle" | "scanning" | "watching" | "error" | "unsupported";

interface VaultState {
  // --- vault identity -------------------------------------------------------
  handle: VaultHandle | null;
  rootDirHandle: FsDirHandle | null;
  manifest: VaultManifest | null;

  // --- ui state -------------------------------------------------------------
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  collapsedFolders: Record<FileId, boolean>;

  // --- workspace tree (Sprint 1) -------------------------------------------
  workspace: WorkspaceState | null;

  // --- content cache --------------------------------------------------------
  contentCache: Record<FileId, string>;

  // --- watcher / lifecycle --------------------------------------------------
  watcherStatus: WatcherStatus;
  scanProgress: number;
  lastScanAt: number | null;
  errorMsg: string | null;

  // --- actions: vault lifecycle --------------------------------------------
  openDemoVault: () => Promise<void>;
  openPicker: () => Promise<void>;
  tryRestorePersistedVault: () => Promise<boolean>;
  closeVault: () => void;
  rescan: () => Promise<void>;

  // --- actions: workspace tree ---------------------------------------------
  splitActiveLeaf: (direction: "horizontal" | "vertical") => void;
  splitLeaf: (leafId: NodeId, direction: "horizontal" | "vertical") => void;
  closeLeaf: (leafId: NodeId) => void;
  setActiveLeaf: (leafId: NodeId) => void;
  setLeafSizes: (branchId: NodeId, sizes: number[]) => void;
  /** Open the full graph view in a leaf (replaces the leaf's current view). */
  openGraphView: (leafId?: NodeId) => void;
  /** Open the canvas (whiteboard) view in a leaf. */
  openCanvasView: (leafId?: NodeId) => void;

  // --- actions: file/tab (operate on the active leaf) ----------------------
  openFile: (fileId: FileId, leafId?: NodeId) => void;
  openFileInLeaf: (leafId: NodeId, fileId: FileId) => void;
  closeTab: (leafId: NodeId, fileId: FileId) => void;
  setActiveTab: (leafId: NodeId, fileId: FileId) => void;
  togglePinTab: (leafId: NodeId, fileId: FileId) => void;
  setLeafScroll: (leafId: NodeId, scroll: { top: number; left: number }) => void;
  setLeafCursor: (leafId: NodeId, cursor: { line: number; ch: number } | null) => void;

  // --- actions: ui ----------------------------------------------------------
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleFolderCollapsed: (folderId: FileId) => void;

  // --- actions: content -----------------------------------------------------
  ensureContent: (fileId: FileId) => Promise<string | null>;
  setContent: (fileId: FileId, text: string, dirty?: boolean) => void;
}

// --- debounced workspace persistence ---------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(get: () => VaultState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    if (!s.workspace || !s.handle) return;
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      workspace: s.workspace,
      ui: {
        leftSidebarOpen: s.leftSidebarOpen,
        rightSidebarOpen: s.rightSidebarOpen,
        collapsedFolders: s.collapsedFolders,
      },
    };
    void saveWorkspace(
      s.rootDirHandle,
      s.handle.kind === "demo",
      snapshot
    );
  }, 300);
}

/** Apply a workspace-tree mutation function then schedule a debounced save. */
function applyWorkspace(
  set: (partial: Partial<VaultState>) => void,
  get: () => VaultState,
  fn: (ws: WorkspaceState) => WorkspaceState
) {
  const cur = get().workspace;
  if (!cur) return;
  const next = fn(cur);
  if (next === cur) return;
  set({ workspace: next });
  scheduleSave(get);
}

export const useVaultStore = create<VaultState>((set, get) => ({
  handle: null,
  rootDirHandle: null,
  manifest: null,

  leftSidebarOpen: true,
  rightSidebarOpen: true,
  collapsedFolders: {},

  workspace: null,

  contentCache: {},

  watcherStatus: "idle",
  scanProgress: 0,
  lastScanAt: null,
  errorMsg: null,

  // -------------------------------------------------------------------------
  openDemoVault: async () => {
    const manifest = buildDemoManifest();
    const content = buildDemoContent();
    const cache: Record<FileId, string> = {};
    for (const [path, text] of Object.entries(content)) {
      const id = manifest.pathIndex[path];
      if (id) cache[id] = text;
    }
    // Try to restore a previously-saved demo workspace; else default.
    let workspace = defaultWorkspaceForManifest(manifest);
    const saved = await loadWorkspace(null, true);
    if (saved) {
      workspace = reconcile(saved.workspace, manifest);
    }
    set({
      handle: { kind: "demo", name: "Demo Vault", hasFsAccess: false },
      rootDirHandle: null,
      manifest,
      contentCache: cache,
      workspace,
      watcherStatus: "watching",
      scanProgress: manifest.counts.files,
      lastScanAt: Date.now(),
      errorMsg: null,
    });
    if (saved) {
      set({
        leftSidebarOpen: saved.ui.leftSidebarOpen,
        rightSidebarOpen: saved.ui.rightSidebarOpen,
        collapsedFolders: saved.ui.collapsedFolders,
      });
    }
    scheduleSave(get);
  },

  openPicker: async () => {
    if (!isFsAccessSupported()) {
      set({ errorMsg: "File System Access API is not supported in this browser." });
      return;
    }
    set({ watcherStatus: "scanning", errorMsg: null, scanProgress: 0 });
    try {
      const dir = await pickVaultDirectory();
      if (!dir) {
        set({ watcherStatus: "idle" });
        return;
      }
      const ok = await verifyPermission(dir, true);
      if (!ok) {
        set({ watcherStatus: "error", errorMsg: "Permission denied for vault folder." });
        return;
      }
      await persistRootHandle(dir);
      const manifest = await walkVault(dir, {
        onProgress: (n) => set({ scanProgress: n }),
      });
      let workspace = defaultWorkspaceForManifest(manifest);
      const saved = await loadWorkspace(dir as never, false);
      if (saved) {
        workspace = reconcile(saved.workspace, manifest);
      }
      set({
        handle: { kind: "fs-access", name: dir.name, hasFsAccess: true },
        rootDirHandle: dir,
        manifest,
        contentCache: {},
        workspace,
        watcherStatus: "watching",
        scanProgress: manifest.counts.files,
        lastScanAt: Date.now(),
        errorMsg: null,
      });
      if (saved) {
        set({
          leftSidebarOpen: saved.ui.leftSidebarOpen,
          rightSidebarOpen: saved.ui.rightSidebarOpen,
          collapsedFolders: saved.ui.collapsedFolders,
        });
      }
      scheduleSave(get);
    } catch (err) {
      set({
        watcherStatus: "error",
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
  },

  tryRestorePersistedVault: async () => {
    if (!isFsAccessSupported()) return false;
    const dir = await loadPersistedRootHandle();
    if (!dir) return false;
    const ok = await verifyPermission(dir, true);
    if (!ok) {
      await clearPersistedRootHandle();
      return false;
    }
    try {
      set({ watcherStatus: "scanning", scanProgress: 0 });
      const manifest = await walkVault(dir, {
        onProgress: (n) => set({ scanProgress: n }),
      });
      let workspace = defaultWorkspaceForManifest(manifest);
      const saved = await loadWorkspace(dir as never, false);
      if (saved) {
        workspace = reconcile(saved.workspace, manifest);
      }
      set({
        handle: { kind: "fs-access", name: dir.name, hasFsAccess: true },
        rootDirHandle: dir,
        manifest,
        contentCache: {},
        workspace,
        watcherStatus: "watching",
        scanProgress: manifest.counts.files,
        lastScanAt: Date.now(),
        errorMsg: null,
      });
      if (saved) {
        set({
          leftSidebarOpen: saved.ui.leftSidebarOpen,
          rightSidebarOpen: saved.ui.rightSidebarOpen,
          collapsedFolders: saved.ui.collapsedFolders,
        });
      }
      scheduleSave(get);
      return true;
    } catch {
      return false;
    }
  },

  closeVault: () => {
    void clearPersistedRootHandle();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({
      handle: null,
      rootDirHandle: null,
      manifest: null,
      workspace: null,
      contentCache: {},
      watcherStatus: "idle",
      scanProgress: 0,
      lastScanAt: null,
      errorMsg: null,
    });
  },

  rescan: async () => {
    const { rootDirHandle, handle, workspace } = get();
    if (!rootDirHandle || handle?.kind !== "fs-access") return;
    set({ watcherStatus: "scanning", scanProgress: 0 });
    try {
      const manifest = await walkVault(rootDirHandle, {
        onProgress: (n) => set({ scanProgress: n }),
      });
      const live = new Set(Object.keys(manifest.nodes));
      const cache = get().contentCache;
      const nextCache: Record<FileId, string> = {};
      for (const [id, text] of Object.entries(cache)) {
        if (live.has(id)) nextCache[id] = text;
      }
      // Reconcile workspace tree against the new manifest (drop dead tabs).
      const nextWorkspace = workspace ? reconcile(workspace, manifest) : null;
      set({
        manifest,
        contentCache: nextCache,
        workspace: nextWorkspace,
        watcherStatus: "watching",
        scanProgress: manifest.counts.files,
        lastScanAt: Date.now(),
      });
      scheduleSave(get);
    } catch (err) {
      set({
        watcherStatus: "error",
        errorMsg: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // --- workspace tree ops --------------------------------------------------
  splitActiveLeaf: (direction) => {
    const ws = get().workspace;
    if (!ws || !ws.activeLeafId) return;
    applyWorkspace(set, get, (w) => splitLeaf(w, ws.activeLeafId!, direction));
  },

  splitLeaf: (leafId, direction) => {
    applyWorkspace(set, get, (w) => splitLeaf(w, leafId, direction));
  },

  closeLeaf: (leafId) => {
    applyWorkspace(set, get, (w) => treeCloseLeaf(w, leafId));
  },

  setActiveLeaf: (leafId) => {
    applyWorkspace(set, get, (w) => ({ ...w, activeLeafId: leafId }));
  },

  setLeafSizes: (branchId, sizes) => {
    applyWorkspace(set, get, (w) => {
      const next = mapBranch(w.root, branchId, (b) => ({ ...b, sizes: [...sizes] }));
      return next === w.root ? w : { ...w, root: next };
    });
  },

  openGraphView: (leafId) => {
    const ws = get().workspace;
    if (!ws) return;
    const target = leafId ?? ws.activeLeafId ?? listLeaves(ws.root)[0]?.id;
    if (!target) return;
    applyWorkspace(set, get, (w) =>
      updateLeafView(w, target, () => ({ kind: "graph" }))
    );
  },

  openCanvasView: (leafId) => {
    const ws = get().workspace;
    if (!ws) return;
    const target = leafId ?? ws.activeLeafId ?? listLeaves(ws.root)[0]?.id;
    if (!target) return;
    applyWorkspace(set, get, (w) =>
      updateLeafView(w, target, () => ({ kind: "canvas" }))
    );
  },

  // --- file/tab ops --------------------------------------------------------
  openFile: (fileId, leafId) => {
    const { manifest, workspace } = get();
    if (!manifest || !workspace) return;
    const node = manifest.nodes[fileId];
    if (!node || node.kind !== "file") return;
    const targetLeaf = leafId ?? workspace.activeLeafId ?? listLeaves(workspace.root)[0]?.id;
    if (!targetLeaf) return;
    applyWorkspace(set, get, (w) => openFileInLeaf(w, targetLeaf, fileId));
  },

  openFileInLeaf: (leafId, fileId) => {
    const { manifest } = get();
    if (!manifest) return;
    const node = manifest.nodes[fileId];
    if (!node || node.kind !== "file") return;
    applyWorkspace(set, get, (w) => openFileInLeaf(w, leafId, fileId));
  },

  closeTab: (leafId, fileId) => {
    applyWorkspace(set, get, (w) => closeTabInLeaf(w, leafId, fileId));
  },

  setActiveTab: (leafId, fileId) => {
    applyWorkspace(set, get, (w) => setActiveTabInLeaf(w, leafId, fileId));
  },

  togglePinTab: (leafId, fileId) => {
    applyWorkspace(set, get, (w) => togglePinTabInLeaf(w, leafId, fileId));
  },

  setLeafScroll: (leafId, scroll) => {
    applyWorkspace(set, get, (w) => setLeafScroll(w, leafId, scroll));
  },

  setLeafCursor: (leafId, cursor) => {
    applyWorkspace(set, get, (w) => setLeafCursor(w, leafId, cursor));
  },

  // --- ui ------------------------------------------------------------------
  toggleLeftSidebar: () => {
    set({ leftSidebarOpen: !get().leftSidebarOpen });
    scheduleSave(get);
  },
  toggleRightSidebar: () => {
    set({ rightSidebarOpen: !get().rightSidebarOpen });
    scheduleSave(get);
  },

  toggleFolderCollapsed: (folderId) => {
    const cur = get().collapsedFolders;
    set({ collapsedFolders: { ...cur, [folderId]: !cur[folderId] } });
    scheduleSave(get);
  },

  // --- content -------------------------------------------------------------
  ensureContent: async (fileId) => {
    const { manifest, contentCache, rootDirHandle, handle } = get();
    if (!manifest) return null;
    if (contentCache[fileId] !== undefined) return contentCache[fileId];
    const node = manifest.nodes[fileId];
    if (!node || node.kind !== "file") return null;
    if (handle?.kind === "demo") {
      return contentCache[fileId] ?? null;
    }
    if (!rootDirHandle) return null;
    try {
      const { readFileText } = await import("@/lib/vault/fs");
      const text = await readFileText(rootDirHandle, node.path);
      set({ contentCache: { ...get().contentCache, [fileId]: text } });
      return text;
    } catch (err) {
      set({
        errorMsg: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  setContent: (fileId, text, dirty = true) => {
    const nextCache = { ...get().contentCache, [fileId]: text };
    // Mark the tab dirty in whichever leaf hosts it.
    const ws = get().workspace;
    if (ws) {
      const next = markTabDirty(ws, fileId, dirty);
      set({ contentCache: nextCache, workspace: next });
      scheduleSave(get);
    } else {
      set({ contentCache: nextCache });
    }
  },
}));

// --- helpers ---------------------------------------------------------------

/** Immutably set dirty on every tab matching fileId across all leaves. */
function markTabDirty(ws: WorkspaceState, fileId: FileId, dirty: boolean): WorkspaceState {
  const nextRoot = mapLeaves(ws.root, (leaf) => {
    if (leaf.view.kind !== "editor") return leaf;
    if (!leaf.view.tabs.some((t) => t.fileId === fileId)) return leaf;
    return {
      ...leaf,
      view: {
        ...leaf.view,
        tabs: leaf.view.tabs.map((t) => (t.fileId === fileId ? { ...t, dirty } : t)),
      },
    };
  });
  return nextRoot === ws.root ? ws : { ...ws, root: nextRoot };
}

/** Immutably map a branch by id; returns same ref if not found. */
function mapBranch(
  root: WorkspaceState["root"],
  branchId: NodeId,
  fn: (b: Extract<WorkspaceState["root"], { type: "branch" }>) => Extract<WorkspaceState["root"], { type: "branch" }>
): WorkspaceState["root"] {
  if (root.type === "leaf") return root;
  if (root.id === branchId) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const r = mapBranch(c, branchId, fn);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...root, children } : root;
}

/** Immutably map every leaf in the tree. */
function mapLeaves(
  root: WorkspaceState["root"],
  fn: (leaf: Extract<WorkspaceState["root"], { type: "leaf" }>) => Extract<WorkspaceState["root"], { type: "leaf" }>
): WorkspaceState["root"] {
  if (root.type === "leaf") return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const r = mapLeaves(c, fn);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...root, children } : root;
}

// --- selectors -------------------------------------------------------------

/**
 * The fileId of the active tab in the active leaf, or null. Convenience hook
 * so components that only care about "what file is focused" don't need to
 * walk the workspace tree themselves.
 */
export function useActiveFileId(): FileId | null {
  return useVaultStore((s) => {
    if (!s.workspace) return null;
    const leaf = s.workspace.activeLeafId
      ? findLeaf(s.workspace.root, s.workspace.activeLeafId)
      : null;
    if (!leaf || leaf.view.kind !== "editor") return null;
    return leaf.view.activeTabId;
  });
}

export { clearWorkspace };
