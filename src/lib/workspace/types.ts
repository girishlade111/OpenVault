/**
 * Workspace tree data model.
 *
 * The center area of the app is a recursive tree of panes. A `Branch` node
 * is a resizable split (horizontal or vertical) holding N children. A `Leaf`
 * node hosts a single `ViewInstance` (an editor with its own tab set, a graph
 * view, a canvas, etc.).
 *
 * Why a tree instead of a flat tab list?
 *  - Splits are recursive: you can split a split. A flat list can't express
 *    "this pane is split vertically, and its right half is split horizontally".
 *  - Each leaf owns its own tab set, so two side-by-side panes can show
 *    different notes simultaneously.
 *  - The tree serializes cleanly to JSON for session persistence.
 *
 * The tree is immutable: every mutation returns a new `WorkspaceState`. The
 * store holds the current state and replaces it atomically.
 */

import type { FileId } from "@/lib/vault/types";

/** Stable identifier for a workspace node (branch or leaf). */
export type NodeId = string;

/** A single tab inside an editor leaf. */
export interface EditorTab {
  fileId: FileId;
  /** Pinned tabs resist auto-eviction and stay leftmost. */
  pinned: boolean;
  /** True if there are unsaved edits in memory. */
  dirty: boolean;
}

/** Persisted scroll position for a leaf's content. */
export interface ScrollPos {
  top: number;
  left: number;
}

/** Persisted cursor position (line/character). */
export interface CursorPos {
  line: number;
  ch: number;
}

/** An editor view: a tab strip + active tab + scroll/cursor restoration. */
export interface EditorView {
  kind: "editor";
  tabs: EditorTab[];
  activeTabId: FileId | null;
  scroll: ScrollPos;
  cursor: CursorPos | null;
}

/** Placeholder view for a fresh leaf with nothing open yet. */
export interface EmptyView {
  kind: "empty";
}

/** A full-screen graph view (force-directed link visualization). */
export interface GraphViewInstance {
  kind: "graph";
}

/** A full-screen canvas (infinite whiteboard). */
export interface CanvasViewInstance {
  kind: "canvas";
}

/**
 * A view instance hosted by a leaf. This is a discriminated union so future
 * sprints can add `GraphView`, `CanvasView`, `SearchView`, `SettingsView`
 * without touching the tree logic.
 */
export type ViewInstance = EditorView | EmptyView | GraphViewInstance | CanvasViewInstance;

/** A resizable split pane. */
export interface BranchNode {
  type: "branch";
  id: NodeId;
  direction: "horizontal" | "vertical";
  children: WorkspaceNode[];
  /**
   * Size percentages per child, summing to 100. Persisted so the layout
   * survives reloads. One entry per child; maintained by the tree ops.
   */
  sizes: number[];
}

/** A leaf hosting a single view instance. */
export interface LeafNode {
  type: "leaf";
  id: NodeId;
  view: ViewInstance;
}

export type WorkspaceNode = BranchNode | LeafNode;

/** The complete workspace state. */
export interface WorkspaceState {
  root: WorkspaceNode;
  /** Which leaf currently has keyboard focus. */
  activeLeafId: NodeId | null;
}

/** Drop zone for moving a leaf/tab onto another leaf. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** Serializeable shape written to workspace.json / localStorage. */
export interface WorkspaceSnapshot {
  version: 1;
  workspace: WorkspaceState;
  /** Sidebar + tree-collapse UI state, persisted alongside the layout. */
  ui: {
    leftSidebarOpen: boolean;
    rightSidebarOpen: boolean;
    collapsedFolders: Record<FileId, boolean>;
  };
}
