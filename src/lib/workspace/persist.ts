/**
 * Workspace persistence.
 *
 * The workspace tree (splits, leaves, open tabs, scroll/cursor) is serialized
 * to a `WorkspaceSnapshot` and saved:
 *  - FSA vaults → `.vault/workspace.json` inside the vault folder (plain text,
 *    version-controlled with the user's notes if they wish).
 *  - Demo vault  → `localStorage` keyed `vault:demo:workspace`.
 *
 * On load, the snapshot is reconciled against the current manifest: any tab
 * whose fileId no longer exists (file deleted externally) is dropped, and
 * leaves emptied by reconciliation are reset to an empty editor view.
 *
 * Saves are debounced by the store; this module just provides the IO.
 */

import type { FileId, VaultManifest } from "@/lib/vault/types";
import type { FsDirHandle } from "@/lib/vault/fs";
import {
  createDefaultWorkspace,
  listLeaves,
  openFileInLeaf,
} from "./tree";
import type {
  ViewInstance,
  WorkspaceNode,
  WorkspaceSnapshot,
  WorkspaceState,
} from "./types";

const WORKSPACE_PATH = ".vault/workspace.json";
const DEMO_LS_KEY = "vault:demo:workspace";

// --- serialize / deserialize ----------------------------------------------

export function serialize(state: WorkspaceState, ui: WorkspaceSnapshot["ui"]): string {
  const snapshot: WorkspaceSnapshot = {
    version: 1,
    workspace: state,
    ui,
  };
  return JSON.stringify(snapshot, null, 2);
}

export function deserialize(text: string): WorkspaceSnapshot | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;

    // Version migration path: support future format changes.
    const version = parsed.version;
    if (typeof version !== "number" || version < 1) return null;

    // For now only version 1 is supported. When future versions are added,
    // migration logic can be inserted here (e.g., if version === 2, migrate).
    if (version !== 1) {
      console.warn(`[workspace] Unknown workspace.json version: ${version}. Falling back to default.`);
      return null;
    }

    if (!parsed.workspace) return null;
    if (!isValidWorkspace(parsed.workspace.root)) return null;

    // Ensure activeLeafId is consistent: must reference an existing leaf.
    const leaves = listLeavesFromNode(parsed.workspace.root);
    if (parsed.workspace.activeLeafId && !leaves.includes(parsed.workspace.activeLeafId)) {
      parsed.workspace.activeLeafId = leaves[0] ?? null;
    }

    return parsed as WorkspaceSnapshot;
  } catch {
    // JSON parse failure or any structural issue -- fall back to default.
    return null;
  }
}

/** Collect all leaf IDs from a workspace node tree (for validation). */
function listLeavesFromNode(node: WorkspaceNode): string[] {
  if (node.type === "leaf") return [node.id];
  if (node.type === "branch") {
    return node.children.flatMap(listLeavesFromNode);
  }
  return [];
}

/** Structural validation: every branch has ≥2 children, ids are strings. */
function isValidWorkspace(node: WorkspaceNode): boolean {
  if (node.type === "leaf") {
    return typeof node.id === "string" && isValidView(node.view);
  }
  if (!Array.isArray(node.children) || node.children.length < 2) return false;
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return false;
  return node.children.every(isValidWorkspace);
}

function isValidView(view: ViewInstance): boolean {
  if (view.kind === "empty") return true;
  if (view.kind === "graph") return true;
  if (view.kind === "canvas") return true;
  if (view.kind === "editor") {
    return Array.isArray(view.tabs) && (view.activeTabId === null || typeof view.activeTabId === "string");
  }
  return false;
}

// --- reconciliation --------------------------------------------------------

/**
 * Drop any tabs whose fileId no longer exists in the manifest. Reset leaves
 * that become empty. Returns a fresh, manifest-consistent workspace state.
 */
export function reconcile(
  state: WorkspaceState,
  manifest: VaultManifest
): WorkspaceState {
  const liveIds = new Set(Object.keys(manifest.nodes));
  let root = reconcileNode(state.root, liveIds);
  // If reconciliation emptied the root leaf's tabs, keep the leaf but as empty.
  if (root.type === "leaf" && root.view.kind === "editor" && root.view.tabs.length === 0) {
    root = { ...root, view: { ...root.view, tabs: [], activeTabId: null } };
  }
  // Ensure activeLeafId still exists.
  const leaves = listLeaves(root);
  const activeLeafId = leaves.some((l) => l.id === state.activeLeafId)
    ? state.activeLeafId
    : leaves[0]?.id ?? null;
  return { root, activeLeafId };
}

function reconcileNode(
  node: WorkspaceNode,
  liveIds: Set<FileId>
): WorkspaceNode {
  if (node.type === "leaf") {
    return { ...node, view: reconcileView(node.view, liveIds) };
  }
  return {
    ...node,
    children: node.children.map((c) => reconcileNode(c, liveIds)),
  };
}

function reconcileView(view: ViewInstance, liveIds: Set<FileId>): ViewInstance {
  if (view.kind !== "editor") return view;
  const tabs = view.tabs.filter((t) => liveIds.has(t.fileId));
  const activeTabId =
    view.activeTabId && liveIds.has(view.activeTabId) ? view.activeTabId : tabs[0]?.fileId ?? null;
  return { ...view, tabs, activeTabId };
}

// --- IO: load --------------------------------------------------------------

export async function loadWorkspace(
  handle: FsDirHandle | null,
  isDemo: boolean
): Promise<WorkspaceSnapshot | null> {
  if (isDemo) {
    try {
      const raw = localStorage.getItem(DEMO_LS_KEY);
      return raw ? deserialize(raw) : null;
    } catch {
      return null;
    }
  }
  if (!handle) return null;
  try {
    const { getEntryByPath, readFileText } = await import("@/lib/vault/fs");
    const entry = await getEntryByPath(handle, WORKSPACE_PATH);
    if (!entry || entry.kind !== "file") return null;
    const text = await readFileText(handle, WORKSPACE_PATH);
    return deserialize(text);
  } catch {
    return null;
  }
}

export async function saveWorkspace(
  handle: FsDirHandle | null,
  isDemo: boolean,
  snapshot: WorkspaceSnapshot
): Promise<void> {
  const text = serialize(snapshot.workspace, snapshot.ui);
  if (isDemo) {
    try {
      localStorage.setItem(DEMO_LS_KEY, text);
    } catch {
      // quota / disabled storage — non-fatal
    }
    return;
  }
  if (!handle) return;
  try {
    const { writeFileText } = await import("@/lib/vault/fs");
    await writeFileText(handle, WORKSPACE_PATH, text);
  } catch {
    // permission revoked mid-session — non-fatal; next save will retry
  }
}

export async function clearWorkspace(
  handle: FsDirHandle | null,
  isDemo: boolean
): Promise<void> {
  if (isDemo) {
    try {
      localStorage.removeItem(DEMO_LS_KEY);
    } catch {
      // ignore
    }
    return;
  }
  if (!handle) return;
  try {
    const dirEntry = await (handle as unknown as {
      getDirectoryHandle: (n: string, opts?: { create?: boolean }) => Promise<FsDirHandle>;
    }).getDirectoryHandle(".vault", { create: false }).catch(() => null);
    if (!dirEntry) return;
    await (dirEntry as unknown as {
      removeEntry: (n: string) => Promise<void>;
    }).removeEntry("workspace.json").catch(() => null);
  } catch {
    // ignore
  }
}

// --- default factory with manifest awareness ------------------------------

/**
 * Build a default workspace for a freshly-opened vault. If the manifest has a
 * `Welcome` / `README` / `index` note, open it in the single leaf; otherwise
 * leave the leaf empty.
 */
export function defaultWorkspaceForManifest(manifest: VaultManifest): WorkspaceState {
  const state = createDefaultWorkspace();
  const candidates = ["Welcome.md", "README.md", "Index.md", "Home.md"];
  for (const path of candidates) {
    const id = manifest.pathIndex[path];
    if (id && state.activeLeafId) {
      return openFileInLeaf(state, state.activeLeafId, id);
    }
  }
  return state;
}

// Re-export for the store's convenience.
export { createDefaultWorkspace } from "./tree";
