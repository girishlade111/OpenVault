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
  VaultNode,
} from "@/lib/vault/types";
import { makeFileId } from "@/lib/vault/id";
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
  reorderTabsInLeaf,
  moveTabBetweenLeaves,
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
  reorderTabs: (leafId: NodeId, fromIndex: number, toIndex: number) => void;
  moveTab: (fromLeafId: NodeId, toLeafId: NodeId, fileId: FileId, insertIndex?: number) => void;
  setLeafScroll: (leafId: NodeId, scroll: { top: number; left: number }) => void;
  setLeafCursor: (leafId: NodeId, cursor: { line: number; ch: number } | null) => void;

  // --- actions: file tree CRUD -----------------------------------------------
  createFile: (parentFolderId: FileId, name: string) => FileId | null;
  createFolder: (parentFolderId: FileId, name: string) => FileId | null;
  renameNode: (fileId: FileId, newName: string) => boolean;
  deleteNode: (fileId: FileId) => void;
  moveNode: (fileId: FileId, newParentId: FileId) => void;

  // --- actions: file tree sort / filter ------------------------------------
  sortMode: "name-asc" | "name-desc" | "mtime-desc" | "mtime-asc" | "ctime-desc";
  setSortMode: (mode: VaultState["sortMode"]) => void;

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

  reorderTabs: (leafId, fromIndex, toIndex) => {
    applyWorkspace(set, get, (w) => reorderTabsInLeaf(w, leafId, fromIndex, toIndex));
  },

  moveTab: (fromLeafId, toLeafId, fileId, insertIndex) => {
    applyWorkspace(set, get, (w) => moveTabBetweenLeaves(w, fromLeafId, toLeafId, fileId, insertIndex));
  },

  setLeafScroll: (leafId, scroll) => {
    applyWorkspace(set, get, (w) => setLeafScroll(w, leafId, scroll));
  },

  setLeafCursor: (leafId, cursor) => {
    applyWorkspace(set, get, (w) => setLeafCursor(w, leafId, cursor));
  },

  // --- file tree CRUD -------------------------------------------------------
  sortMode: "name-asc",
  setSortMode: (mode) => set({ sortMode: mode }),

  createFile: (parentFolderId, name) => {
    const { manifest, handle } = get();
    if (!manifest) return null;
    const parent = manifest.nodes[parentFolderId];
    if (!parent || parent.kind !== "folder") return null;

    const filePath = parent.path ? `${parent.path}/${name}` : name;
    // Prevent duplicates
    if (manifest.pathIndex[filePath]) return null;

    const id = makeFileId(filePath);
    const ext = name.split(".").pop()?.toLowerCase() ?? null;
    const node: VaultNode = {
      id,
      name,
      path: filePath,
      kind: "file",
      parentId: parentFolderId,
      childIds: [],
      extension: ext,
      size: 0,
      mtime: Date.now(),
      isMarkdown: ext === "md" || ext === "markdown",
      isImage: false,
      isCanvas: ext === "canvas",
    };

    const nextNodes = { ...manifest.nodes, [id]: node };
    const nextParent = { ...parent, childIds: [...parent.childIds, id] };
    nextNodes[parentFolderId] = nextParent;

    // Sort parent childIds: folders first, then files, both alpha
    nextParent.childIds.sort((a, b) => {
      const A = nextNodes[a];
      const B = nextNodes[b];
      if (!A || !B) return 0;
      if (A.kind !== B.kind) return A.kind === "folder" ? -1 : 1;
      return A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
    });

    const nextManifest: VaultManifest = {
      ...manifest,
      nodes: nextNodes,
      pathIndex: { ...manifest.pathIndex, [filePath]: id },
      counts: {
        ...manifest.counts,
        files: manifest.counts.files + 1,
        markdown: manifest.counts.markdown + (node.isMarkdown ? 1 : 0),
      },
    };

    // For demo vault, also seed empty content
    if (handle?.kind === "demo") {
      const nextCache = { ...get().contentCache, [id]: "" };
      set({ manifest: nextManifest, contentCache: nextCache });
    } else {
      set({ manifest: nextManifest });
    }
    scheduleSave(get);
    return id;
  },

  createFolder: (parentFolderId, name) => {
    const { manifest } = get();
    if (!manifest) return null;
    const parent = manifest.nodes[parentFolderId];
    if (!parent || parent.kind !== "folder") return null;

    const folderPath = parent.path ? `${parent.path}/${name}` : name;
    if (manifest.pathIndex[folderPath]) return null;

    const id = makeFileId(folderPath);
    const node: VaultNode = {
      id,
      name,
      path: folderPath,
      kind: "folder",
      parentId: parentFolderId,
      childIds: [],
      extension: null,
      size: 0,
      mtime: Date.now(),
      isMarkdown: false,
      isImage: false,
      isCanvas: false,
    };

    const nextNodes = { ...manifest.nodes, [id]: node };
    const nextParent = { ...parent, childIds: [...parent.childIds, id] };
    nextNodes[parentFolderId] = nextParent;

    nextParent.childIds.sort((a, b) => {
      const A = nextNodes[a];
      const B = nextNodes[b];
      if (!A || !B) return 0;
      if (A.kind !== B.kind) return A.kind === "folder" ? -1 : 1;
      return A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
    });

    const nextManifest: VaultManifest = {
      ...manifest,
      nodes: nextNodes,
      pathIndex: { ...manifest.pathIndex, [folderPath]: id },
      counts: {
        ...manifest.counts,
        folders: manifest.counts.folders + 1,
      },
    };
    set({ manifest: nextManifest });
    scheduleSave(get);
    return id;
  },

  renameNode: (fileId, newName) => {
    const { manifest } = get();
    if (!manifest) return false;
    const node = manifest.nodes[fileId];
    if (!node || !node.parentId) return false; // Can't rename root

    const parent = manifest.nodes[node.parentId];
    if (!parent) return false;

    const newPath = parent.path ? `${parent.path}/${newName}` : newName;
    // Don't allow renaming to existing path (unless same node)
    if (manifest.pathIndex[newPath] && manifest.pathIndex[newPath] !== fileId) return false;

    const newId = makeFileId(newPath);
    const ext = node.kind === "file" ? (newName.split(".").pop()?.toLowerCase() ?? null) : null;

    // Build updated path index
    const nextPathIndex = { ...manifest.pathIndex };
    const nextNodes = { ...manifest.nodes };
    const nextContentCache = { ...get().contentCache };

    // Helper to recursively update paths
    const updatePaths = (nodeId: FileId, oldBasePath: string, newBasePath: string) => {
      const n = nextNodes[nodeId];
      if (!n) return;
      const oldPath = n.path;
      const updatedPath = oldPath === oldBasePath
        ? newBasePath
        : newBasePath + oldPath.slice(oldBasePath.length);
      const updatedId = makeFileId(updatedPath);
      const updatedName = nodeId === fileId ? newName : n.name;
      const updatedExt = n.kind === "file" ? (updatedName.split(".").pop()?.toLowerCase() ?? null) : null;

      // Remove old path index entry
      delete nextPathIndex[oldPath];
      // Remove old node
      delete nextNodes[nodeId];
      // Transfer content if it exists
      if (nextContentCache[nodeId] !== undefined) {
        nextContentCache[updatedId] = nextContentCache[nodeId];
        delete nextContentCache[nodeId];
      }

      // Create updated node
      const updatedNode: VaultNode = {
        ...n,
        id: updatedId,
        name: updatedName,
        path: updatedPath,
        extension: updatedExt,
        isMarkdown: updatedExt === "md" || updatedExt === "markdown",
        isCanvas: updatedExt === "canvas",
        childIds: [...n.childIds], // Will be updated with new child IDs
      };
      nextNodes[updatedId] = updatedNode;
      nextPathIndex[updatedPath] = updatedId;

      // Recursively update children
      const newChildIds: FileId[] = [];
      for (const childId of n.childIds) {
        const child = nextNodes[childId] ?? manifest.nodes[childId];
        if (child) {
          const childNewPath = updatedPath ? `${updatedPath}/${child.name}` : child.name;
          const childNewId = makeFileId(childNewPath);
          updatePaths(childId, child.path, childNewPath);
          // Update the child's parentId
          const updatedChild = nextNodes[childNewId];
          if (updatedChild) {
            nextNodes[childNewId] = { ...updatedChild, parentId: updatedId };
          }
          newChildIds.push(childNewId);
        }
      }
      nextNodes[updatedId] = { ...nextNodes[updatedId], childIds: newChildIds };
    };

    updatePaths(fileId, node.path, newPath);

    // Update parent's childIds to reference the new id
    const updatedParent = { ...parent, childIds: parent.childIds.map((cid) => (cid === fileId ? newId : cid)) };
    // Re-sort
    updatedParent.childIds.sort((a, b) => {
      const A = nextNodes[a];
      const B = nextNodes[b];
      if (!A || !B) return 0;
      if (A.kind !== B.kind) return A.kind === "folder" ? -1 : 1;
      return A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
    });
    nextNodes[updatedParent.id] = updatedParent;

    const nextManifest: VaultManifest = {
      ...manifest,
      nodes: nextNodes,
      pathIndex: nextPathIndex,
    };

    // Update workspace tabs referencing old file ids
    const ws = get().workspace;
    let nextWorkspace = ws;
    if (ws && fileId !== newId) {
      nextWorkspace = {
        ...ws,
        root: mapLeaves(ws.root, (leaf) => {
          if (leaf.view.kind !== "editor") return leaf;
          const hasOld = leaf.view.tabs.some((t) => t.fileId === fileId);
          if (!hasOld) return leaf;
          return {
            ...leaf,
            view: {
              ...leaf.view,
              tabs: leaf.view.tabs.map((t) => (t.fileId === fileId ? { ...t, fileId: newId } : t)),
              activeTabId: leaf.view.activeTabId === fileId ? newId : leaf.view.activeTabId,
            },
          };
        }),
      };
    }

    set({ manifest: nextManifest, contentCache: nextContentCache, workspace: nextWorkspace });
    scheduleSave(get);
    return true;
  },

  deleteNode: (fileId) => {
    const { manifest } = get();
    if (!manifest) return;
    const node = manifest.nodes[fileId];
    if (!node || !node.parentId) return; // Can't delete root

    const nextNodes = { ...manifest.nodes };
    const nextPathIndex = { ...manifest.pathIndex };
    const nextContentCache = { ...get().contentCache };
    let removedFiles = 0;
    let removedFolders = 0;
    let removedMarkdown = 0;

    // Collect all node ids to remove (recursive for folders)
    const collectIds = (nid: FileId): FileId[] => {
      const n = nextNodes[nid];
      if (!n) return [];
      if (n.kind === "folder") {
        const childResults = n.childIds.flatMap(collectIds);
        return [nid, ...childResults];
      }
      return [nid];
    };

    const idsToRemove = collectIds(fileId);
    const fileIdsToRemove = new Set<FileId>();

    for (const rid of idsToRemove) {
      const rNode = nextNodes[rid];
      if (!rNode) continue;
      if (rNode.kind === "file") {
        removedFiles++;
        if (rNode.isMarkdown) removedMarkdown++;
        fileIdsToRemove.add(rid);
      } else {
        removedFolders++;
      }
      delete nextPathIndex[rNode.path];
      delete nextNodes[rid];
      delete nextContentCache[rid];
    }

    // Remove from parent's childIds
    const parent = nextNodes[node.parentId];
    if (parent) {
      nextNodes[node.parentId] = {
        ...parent,
        childIds: parent.childIds.filter((cid) => cid !== fileId),
      };
    }

    const nextManifest: VaultManifest = {
      ...manifest,
      nodes: nextNodes,
      pathIndex: nextPathIndex,
      counts: {
        ...manifest.counts,
        files: manifest.counts.files - removedFiles,
        folders: manifest.counts.folders - removedFolders,
        markdown: manifest.counts.markdown - removedMarkdown,
      },
    };

    // Close all tabs for deleted files
    const ws = get().workspace;
    let nextWorkspace = ws;
    if (ws && fileIdsToRemove.size > 0) {
      nextWorkspace = {
        ...ws,
        root: mapLeaves(ws.root, (leaf) => {
          if (leaf.view.kind !== "editor") return leaf;
          const hasRemoved = leaf.view.tabs.some((t) => fileIdsToRemove.has(t.fileId));
          if (!hasRemoved) return leaf;
          const nextTabs = leaf.view.tabs.filter((t) => !fileIdsToRemove.has(t.fileId));
          let nextActive = leaf.view.activeTabId;
          if (nextActive && fileIdsToRemove.has(nextActive)) {
            nextActive = nextTabs[0]?.fileId ?? null;
          }
          return {
            ...leaf,
            view: { ...leaf.view, tabs: nextTabs, activeTabId: nextActive },
          };
        }),
      };
    }

    set({ manifest: nextManifest, contentCache: nextContentCache, workspace: nextWorkspace });
    scheduleSave(get);
  },

  moveNode: (fileId, newParentId) => {
    const { manifest } = get();
    if (!manifest) return;
    const node = manifest.nodes[fileId];
    if (!node || !node.parentId) return;
    if (node.parentId === newParentId) return;
    const newParent = manifest.nodes[newParentId];
    if (!newParent || newParent.kind !== "folder") return;

    // Prevent moving a folder into itself or its descendants
    if (node.kind === "folder") {
      let cursor: VaultNode | null = newParent;
      while (cursor) {
        if (cursor.id === fileId) return;
        cursor = cursor.parentId ? manifest.nodes[cursor.parentId] : null;
      }
    }

    const nextNodes = { ...manifest.nodes };

    // Remove from old parent
    const oldParent = nextNodes[node.parentId];
    if (oldParent) {
      nextNodes[node.parentId] = {
        ...oldParent,
        childIds: oldParent.childIds.filter((cid) => cid !== fileId),
      };
    }

    // Build new path
    const newPath = newParent.path ? `${newParent.path}/${node.name}` : node.name;
    const newId = makeFileId(newPath);

    const nextPathIndex = { ...manifest.pathIndex };
    const nextContentCache = { ...get().contentCache };

    // Recursively update paths
    const remap: Record<FileId, FileId> = {};
    const updatePaths = (nid: FileId, oldBasePath: string, newBasePath: string) => {
      const n = nextNodes[nid] ?? manifest.nodes[nid];
      if (!n) return;
      const updatedPath = n.path === oldBasePath
        ? newBasePath
        : newBasePath + n.path.slice(oldBasePath.length);
      const updatedId = makeFileId(updatedPath);
      remap[nid] = updatedId;

      delete nextPathIndex[n.path];
      delete nextNodes[nid];
      if (nextContentCache[nid] !== undefined) {
        nextContentCache[updatedId] = nextContentCache[nid];
        delete nextContentCache[nid];
      }

      const updatedNode: VaultNode = {
        ...n,
        id: updatedId,
        path: updatedPath,
        parentId: nid === fileId ? newParentId : (n.parentId ? (remap[n.parentId] ?? n.parentId) : null),
        childIds: [...n.childIds],
      };
      nextNodes[updatedId] = updatedNode;
      nextPathIndex[updatedPath] = updatedId;

      const newChildIds: FileId[] = [];
      for (const childId of n.childIds) {
        updatePaths(childId, manifest.nodes[childId]?.path ?? "", updatedPath + "/" + (manifest.nodes[childId]?.name ?? ""));
        newChildIds.push(remap[childId] ?? childId);
      }
      nextNodes[updatedId] = { ...nextNodes[updatedId], childIds: newChildIds };
    };

    updatePaths(fileId, node.path, newPath);

    // Add to new parent
    const updatedNewParent = nextNodes[newParentId] ?? newParent;
    nextNodes[newParentId] = {
      ...updatedNewParent,
      childIds: [...updatedNewParent.childIds, newId],
    };

    // Sort new parent childIds
    nextNodes[newParentId].childIds.sort((a, b) => {
      const A = nextNodes[a];
      const B = nextNodes[b];
      if (!A || !B) return 0;
      if (A.kind !== B.kind) return A.kind === "folder" ? -1 : 1;
      return A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
    });

    const nextManifest: VaultManifest = {
      ...manifest,
      nodes: nextNodes,
      pathIndex: nextPathIndex,
    };

    // Update workspace tabs
    const ws = get().workspace;
    let nextWorkspace = ws;
    if (ws && Object.keys(remap).length > 0) {
      nextWorkspace = {
        ...ws,
        root: mapLeaves(ws.root, (leaf) => {
          if (leaf.view.kind !== "editor") return leaf;
          const hasOld = leaf.view.tabs.some((t) => remap[t.fileId]);
          if (!hasOld) return leaf;
          return {
            ...leaf,
            view: {
              ...leaf.view,
              tabs: leaf.view.tabs.map((t) => (remap[t.fileId] ? { ...t, fileId: remap[t.fileId] } : t)),
              activeTabId: leaf.view.activeTabId && remap[leaf.view.activeTabId] ? remap[leaf.view.activeTabId] : leaf.view.activeTabId,
            },
          };
        }),
      };
    }

    set({ manifest: nextManifest, contentCache: nextContentCache, workspace: nextWorkspace });
    scheduleSave(get);
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
