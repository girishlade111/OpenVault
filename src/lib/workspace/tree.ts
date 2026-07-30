/**
 * Pure, immutable workspace tree operations.
 *
 * Every function takes a `WorkspaceState` (or `WorkspaceNode`) and returns a
 * NEW one. The store applies the result atomically. No mutation happens
 * in-place; this keeps React rendering predictable and makes persistence a
 * simple JSON.stringify of the current state.
 *
 * Invariants maintained by every op:
 *  - A branch always has ≥ 2 children (1-child branches are collapsed).
 *  - `sizes` always has exactly `children.length` entries summing to ~100.
 *  - `activeLeafId` always points to an existing leaf, or null when the tree
 *    is empty (which only happens transiently; closeLeaf refuses to remove
 *    the last leaf and instead resets it to an empty view).
 */

import type {
  BranchNode,
  EditorTab,
  EditorView,
  LeafNode,
  NodeId,
  ViewInstance,
  WorkspaceNode,
  WorkspaceState,
  DropZone,
} from "./types";

let idCounter = 0;
/** Generate a unique node id. Deterministic-enough for client-only state. */
export function genNodeId(prefix: string): NodeId {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Build a fresh editor view with no tabs. */
export function createEditorView(): EditorView {
  return {
    kind: "editor",
    tabs: [],
    activeTabId: null,
    scroll: { top: 0, left: 0 },
    cursor: null,
  };
}

/** Build a fresh empty view. */
export function createEmptyView(): ViewInstance {
  return { kind: "empty" };
}

/** Build a leaf hosting the given view. */
export function createLeaf(view: ViewInstance, id?: NodeId): LeafNode {
  return { type: "leaf", id: id ?? genNodeId("leaf"), view };
}

/** Build a branch from children, distributing sizes evenly. */
export function createBranch(
  direction: "horizontal" | "vertical",
  children: WorkspaceNode[],
  id?: NodeId
): BranchNode {
  const n = Math.max(children.length, 1);
  const each = 100 / n;
  return {
    type: "branch",
    id: id ?? genNodeId("branch"),
    direction,
    children: [...children],
    sizes: Array.from({ length: children.length }, () => each),
  };
}

/** Default workspace: a single empty editor leaf, active. */
export function createDefaultWorkspace(): WorkspaceState {
  const leaf = createLeaf(createEditorView());
  return { root: leaf, activeLeafId: leaf.id };
}

// --- traversal -------------------------------------------------------------

/** Find a node by id. Returns the node and its parent branch (or null at root). */
export function findNode(
  root: WorkspaceNode,
  id: NodeId
): { node: WorkspaceNode; parent: BranchNode | null } | null {
  if (root.id === id) return { node: root, parent: null };
  if (root.type !== "branch") return null;
  for (const child of root.children) {
    if (child.id === id) return { node: child, parent: root };
    const deeper = findNode(child, id);
    if (deeper) return deeper;
  }
  return null;
}

export function findLeaf(root: WorkspaceNode, id: NodeId): LeafNode | null {
  const found = findNode(root, id);
  if (!found || found.node.type !== "leaf") return null;
  return found.node;
}

/** All leaves in left-to-right / top-to-bottom order. */
export function listLeaves(root: WorkspaceNode): LeafNode[] {
  if (root.type === "leaf") return [root];
  return root.children.flatMap(listLeaves);
}

/** Depth of a node in the tree (root = 0). */
export function depthOf(root: WorkspaceNode, id: NodeId, cur = 0): number | null {
  if (root.id === id) return cur;
  if (root.type !== "branch") return null;
  for (const child of root.children) {
    const d = depthOf(child, id, cur + 1);
    if (d !== null) return d;
  }
  return null;
}

// --- structural ops --------------------------------------------------------

/**
 * Replace a leaf with a branch containing [oldLeaf, newLeaf]. The new leaf
 * becomes active. Direction determines the split axis.
 *
 * If the target leaf is the root, the branch becomes the new root.
 */
export function splitLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  direction: "horizontal" | "vertical",
  newView: ViewInstance = createEditorView()
): WorkspaceState {
  const root = state.root;
  const found = findNode(root, leafId);
  if (!found || found.node.type !== "leaf") return state;
  const oldLeaf = found.node;
  const newLeaf = createLeaf(newView);
  const branch = createBranch(direction, [oldLeaf, newLeaf]);

  const nextRoot = replaceNode(root, leafId, branch);
  return { root: nextRoot, activeLeafId: newLeaf.id };
}

/**
 * Remove a leaf. If its parent branch drops to one child, collapse the branch
 * (replace it with the remaining child in the grandparent). The last leaf is
 * never removed — it's reset to an empty editor view instead.
 */
export function closeLeaf(
  state: WorkspaceState,
  leafId: NodeId
): WorkspaceState {
  const root = state.root;

  // Last leaf → reset to empty editor instead of deleting.
  if (root.type === "leaf" && root.id === leafId) {
    const fresh = createLeaf(createEditorView(), root.id);
    return { root: fresh, activeLeafId: fresh.id };
  }

  const found = findNode(root, leafId);
  if (!found || found.node.type !== "leaf" || !found.parent) return state;
  const parent = found.parent;

  const remaining = parent.children.filter((c) => c.id !== leafId);
  const removedIdx = parent.children.findIndex((c) => c.id === leafId);

  if (remaining.length > 1) {
    // Sibling branch stays; re-normalize sizes.
    const newBranch: BranchNode = {
      ...parent,
      children: remaining,
      sizes: normalizeSizes(parent.sizes, removedIdx),
    };
    const nextRoot = replaceNode(root, parent.id, newBranch);
    return { root: nextRoot, activeLeafId: pickNeighborLeaf(state, leafId, removedIdx) };
  }

  // Only one child remains → collapse: replace the branch with that child.
  const survivor = remaining[0];
  const nextRoot = replaceNode(root, parent.id, survivor);
  const leaves = listLeaves(nextRoot);
  const nextActive =
    leaves.find((l) => l.id !== leafId)?.id ?? leaves[0]?.id ?? null;
  // Use removedIdx hint to pick the survivor leaf when sensible.
  void removedIdx;
  return { root: nextRoot, activeLeafId: nextActive };
}

/**
 * Move a leaf (or its tabs) onto another leaf.
 *  - center: merge source's tabs into target, then close source leaf.
 *  - left/right/top/bottom: split target in the given direction and place a
 *    new leaf there containing the source's view; close the source leaf.
 *
 * This is the data-model foundation for Sprint 7's drag-and-drop UI.
 */
export function moveLeaf(
  state: WorkspaceState,
  fromId: NodeId,
  toId: NodeId,
  zone: DropZone
): WorkspaceState {
  if (fromId === toId) return state;
  const fromLeaf = findLeaf(state.root, fromId);
  const toLeaf = findLeaf(state.root, toId);
  if (!fromLeaf || !toLeaf) return state;

  if (zone === "center") {
    // Merge tabs of fromLeaf into toLeaf, then close fromLeaf.
    const merged = mergeViews(toLeaf.view, fromLeaf.view);
    let next = updateLeafView(state, toId, () => merged);
    next = closeLeaf(next, fromId);
    return { ...next, activeLeafId: toId };
  }

  const direction: "horizontal" | "vertical" =
    zone === "left" || zone === "right" ? "horizontal" : "vertical";
  // Split target, placing the moved view in the chosen half.
  const movedView: ViewInstance =
    fromLeaf.view.kind === "editor"
      ? { ...fromLeaf.view, tabs: [...fromLeaf.view.tabs], activeTabId: fromLeaf.view.activeTabId }
      : { kind: "empty" };

  // Order: for "left"/"top" the moved view comes first; for "right"/"bottom" second.
  const newLeaf = createLeaf(movedView);
  const targetLeaf = toLeaf;
  const branch: BranchNode =
    zone === "left" || zone === "top"
      ? createBranch(direction, [newLeaf, targetLeaf])
      : createBranch(direction, [targetLeaf, newLeaf]);

  let nextRoot: WorkspaceNode | null = replaceNode(state.root, toId, branch);
  // Now remove the original source leaf from the tree.
  nextRoot = removeNode(nextRoot, fromId);
  if (nextRoot === null) {
    // Source was the root and got removed — can't happen since we just added
    // a branch elsewhere; fall back safely.
    nextRoot = state.root;
  }
  return { root: nextRoot, activeLeafId: newLeaf.id };
}

// --- leaf view updates -----------------------------------------------------

/** Immutably update a leaf's view via an updater function. */
export function updateLeafView(
  state: WorkspaceState,
  leafId: NodeId,
  updater: (view: ViewInstance) => ViewInstance
): WorkspaceState {
  const nextRoot = mapLeaf(state.root, leafId, (leaf) => ({
    ...leaf,
    view: updater(leaf.view),
  }));
  if (nextRoot === state.root) return state;
  return { ...state, root: nextRoot };
}

/** Open a file in a leaf: if already a tab, activate it; else add + activate. */
export function openFileInLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  fileId: NodeId
): WorkspaceState {
  return updateLeafView(state, leafId, (view) => {
    if (view.kind !== "editor") {
      // Promote empty/other view to an editor with this file.
      const tab: EditorTab = { fileId, pinned: false, dirty: false };
      return {
        kind: "editor",
        tabs: [tab],
        activeTabId: fileId,
        scroll: { top: 0, left: 0 },
        cursor: null,
      };
    }
    if (view.tabs.some((t) => t.fileId === fileId)) {
      return { ...view, activeTabId: fileId };
    }
    const tab: EditorTab = { fileId, pinned: false, dirty: false };
    // Pinned tabs stay leftmost; append after them.
    const pinned = view.tabs.filter((t) => t.pinned);
    const rest = view.tabs.filter((t) => !t.pinned);
    return { ...view, tabs: [...pinned, tab, ...rest], activeTabId: fileId };
  });
}

/** Close a tab in a leaf. If it was active, activate the neighbor. */
export function closeTabInLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  fileId: NodeId
): WorkspaceState {
  return updateLeafView(state, leafId, (view) => {
    if (view.kind !== "editor") return view;
    const idx = view.tabs.findIndex((t) => t.fileId === fileId);
    if (idx === -1) return view;
    const nextTabs = view.tabs.filter((t) => t.fileId !== fileId);
    let nextActive = view.activeTabId;
    if (view.activeTabId === fileId) {
      nextActive = nextTabs[Math.min(idx, nextTabs.length - 1)]?.fileId ?? null;
    }
    return { ...view, tabs: nextTabs, activeTabId: nextActive };
  });
}

export function setActiveTabInLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  fileId: NodeId
): WorkspaceState {
  return updateLeafView(state, leafId, (view) => {
    if (view.kind !== "editor") return view;
    if (!view.tabs.some((t) => t.fileId === fileId)) return view;
    return { ...view, activeTabId: fileId };
  });
}

export function togglePinTabInLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  fileId: NodeId
): WorkspaceState {
  return updateLeafView(state, leafId, (view) => {
    if (view.kind !== "editor") return view;
    let tabs = view.tabs.map((t) =>
      t.fileId === fileId ? { ...t, pinned: !t.pinned } : t
    );
    // Re-sort: pinned first, preserving relative order within each group.
    tabs = [...tabs].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
    return { ...view, tabs };
  });
}

export function setLeafScroll(
  state: WorkspaceState,
  leafId: NodeId,
  scroll: { top: number; left: number }
): WorkspaceState {
  return updateLeafView(state, leafId, (view) =>
    view.kind === "editor" ? { ...view, scroll } : view
  );
}

export function setLeafCursor(
  state: WorkspaceState,
  leafId: NodeId,
  cursor: { line: number; ch: number } | null
): WorkspaceState {
  return updateLeafView(state, leafId, (view) =>
    view.kind === "editor" ? { ...view, cursor } : view
  );
}

// --- internal helpers ------------------------------------------------------

/**
 * Replace the node with `id` by `replacement`, returning a new tree.
 * Returns the original root if the id isn't found.
 */
function replaceNode(
  root: WorkspaceNode,
  id: NodeId,
  replacement: WorkspaceNode
): WorkspaceNode {
  if (root.id === id) return replacement;
  if (root.type !== "branch") return root;
  let changed = false;
  const children = root.children.map((c) => {
    const r = replaceNode(c, id, replacement);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...root, children } : root;
}

/** Remove a node by id. Returns null if the root itself is removed. */
function removeNode(
  root: WorkspaceNode,
  id: NodeId
): WorkspaceNode | null {
  if (root.id === id) return null;
  if (root.type !== "branch") return root;
  let changed = false;
  const children: WorkspaceNode[] = [];
  for (const c of root.children) {
    if (c.id === id) {
      changed = true;
      continue;
    }
    const r = removeNode(c, id);
    if (r !== c) changed = true;
    if (r !== null) children.push(r);
  }
  if (!changed) return root;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]; // collapse 1-child branch
  return { ...root, children, sizes: renormalize(children.length) };
}

/** Immutably map a single leaf by id. Returns same root ref if not found. */
function mapLeaf(
  root: WorkspaceNode,
  leafId: NodeId,
  fn: (leaf: LeafNode) => LeafNode
): WorkspaceNode {
  if (root.type === "leaf") {
    return root.id === leafId ? fn(root) : root;
  }
  let changed = false;
  const children = root.children.map((c) => {
    const r = mapLeaf(c, leafId, fn);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? { ...root, children } : root;
}

/** Merge two views: editor+editor → editor with combined tabs (deduped). */
function mergeViews(a: ViewInstance, b: ViewInstance): ViewInstance {
  if (a.kind !== "editor") return b.kind === "editor" ? { ...b } : a;
  if (b.kind !== "editor") return a;
  const seen = new Set(a.tabs.map((t) => t.fileId));
  const extra = b.tabs.filter((t) => !seen.has(t.fileId));
  return {
    kind: "editor",
    tabs: [...a.tabs, ...extra],
    activeTabId: b.activeTabId ?? a.activeTabId,
    scroll: a.scroll,
    cursor: a.cursor,
  };
}

/** Pick a sensible leaf to activate after closing `leafId`. */
function pickNeighborLeaf(
  state: WorkspaceState,
  leafId: NodeId,
  removedIdx: number
): NodeId | null {
  const leaves = listLeaves(state.root).filter((l) => l.id !== leafId);
  if (leaves.length === 0) return null;
  const idx = Math.min(removedIdx, leaves.length - 1);
  return leaves[idx]?.id ?? leaves[0]?.id ?? null;
}

/** Remove an entry from a sizes array and renormalize survivors to sum 100. */
function normalizeSizes(sizes: number[], removedIdx: number): number[] {
  const rest = sizes.filter((_, i) => i !== removedIdx);
  const sum = rest.reduce((a, b) => a + b, 0);
  if (sum <= 0) return renormalize(rest.length);
  return rest.map((s) => (s / sum) * 100);
}

/** Even split into `n` parts summing to 100. */
function renormalize(n: number): number[] {
  if (n <= 0) return [];
  const each = 100 / n;
  return Array.from({ length: n }, () => each);
}

/**
 * Re-balance a sizes array so it has exactly `n` entries summing to 100,
 * preserving existing proportions where possible. Used after structural
 * changes alter child count.
 */
export function rebalanceSizes(sizes: number[], n: number): number[] {
  if (n <= 0) return [];
  if (sizes.length === n) {
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    return sizes.map((s) => (s / sum) * 100);
  }
  return renormalize(n);
}
