"use client";

import {
  X,
  Pin,
  FileText,
  PenLine,
  SplitSquareHorizontal,
  SplitSquareVertical,
  XCircle,
} from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import type { EditorTab, LeafNode } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MarkdownEditorPane } from "@/components/editor/MarkdownEditorPane";
import { GraphView } from "@/components/graph/GraphView";
import { CanvasView } from "@/components/canvas/CanvasView";

/** A single tab chip inside a leaf's tab strip. */
function TabChip({ leafId, tab }: { leafId: string; tab: EditorTab }) {
  const manifest = useVaultStore((s) => s.manifest);
  // Subscribe to this leaf's view so the chip re-renders when activeTabId
  // changes. The leaf node reference is stable across unrelated state changes
  // (immutable tree), so this won't over-render.
  const leaf = useVaultStore((s) =>
    s.workspace ? findLeafLocal(s.workspace.root, leafId) : null
  );
  const setActive = useVaultStore((s) => s.setActiveTab);
  const closeTab = useVaultStore((s) => s.closeTab);
  const togglePin = useVaultStore((s) => s.togglePinTab);

  if (!manifest || !leaf || leaf.view.kind !== "editor") return null;
  const node = manifest.nodes[tab.fileId];
  if (!node) return null;
  const active = leaf.view.activeTabId === tab.fileId;

  // Drag-drop reorder support
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/tab-file-id", tab.fileId);
    e.dataTransfer.setData("text/tab-leaf-id", leafId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Show visual insertion indicator
    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const el = e.currentTarget as HTMLElement;
    if (e.clientX < midX) {
      el.style.borderLeftColor = "var(--primary)";
      el.style.borderLeftWidth = "2px";
      el.style.borderRightColor = "";
      el.style.borderRightWidth = "";
    } else {
      el.style.borderRightColor = "var(--primary)";
      el.style.borderRightWidth = "2px";
      el.style.borderLeftColor = "";
      el.style.borderLeftWidth = "";
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.style.borderLeftColor = "";
    el.style.borderLeftWidth = "";
    el.style.borderRightColor = "";
    el.style.borderRightWidth = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.style.borderLeftColor = "";
    el.style.borderLeftWidth = "";
    el.style.borderRightColor = "";
    el.style.borderRightWidth = "";

    const dragFileId = e.dataTransfer.getData("text/tab-file-id");
    const dragLeafId = e.dataTransfer.getData("text/tab-leaf-id");
    if (!dragFileId) return;

    const store = useVaultStore.getState();
    const ws = store.workspace;
    if (!ws) return;

    // Determine insertion index based on cursor position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const currentLeaf = findLeafLocal(ws.root, leafId);
    if (!currentLeaf || currentLeaf.view.kind !== "editor") return;
    const targetIdx = currentLeaf.view.tabs.findIndex((t) => t.fileId === tab.fileId);
    const insertIdx = e.clientX < midX ? targetIdx : targetIdx + 1;

    if (dragLeafId === leafId) {
      // Same leaf: reorder
      const fromIdx = currentLeaf.view.tabs.findIndex((t) => t.fileId === dragFileId);
      if (fromIdx !== -1 && fromIdx !== insertIdx) {
        const adjustedTo = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
        store.reorderTabs(leafId, fromIdx, adjustedTo);
      }
    } else {
      // Cross-pane: move tab
      store.moveTab(dragLeafId, leafId, dragFileId, insertIdx);
    }
  };

  // Middle-click to close
  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(leafId, tab.fileId);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 h-full pl-3 pr-2 cursor-default min-w-[120px] max-w-[240px] relative shrink-0 border-x border-t rounded-t-md transition-colors",
        active
          ? "bg-background text-foreground border-border z-10 before:absolute before:top-[-1px] before:inset-x-0 before:h-[2px] before:bg-primary before:rounded-t-md"
          : "bg-transparent text-muted-foreground border-transparent hover:bg-background/50 hover:text-foreground"
      )}
      style={{
        marginBottom: active ? "-1px" : "0",
        borderBottom: active ? "1px solid var(--background)" : undefined,
      }}
      onClick={() => setActive(leafId, tab.fileId)}
      onAuxClick={handleAuxClick}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="tab"
      aria-selected={active}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          togglePin(leafId, tab.fileId);
        }}
        aria-label={tab.pinned ? "Unpin tab" : "Pin tab"}
      >
        <Pin className={cn("w-3 h-3", tab.pinned && "fill-current text-primary")} />
      </Button>
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm flex-1">{node.name}</span>
      {tab.dirty && (
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" aria-label="Unsaved" />
      )}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-5 w-5 p-0 shrink-0",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(leafId, tab.fileId);
        }}
        aria-label="Close tab"
      >
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function LeafEmptyState({ leafId }: { leafId: string }) {
  const splitLeaf = useVaultStore((s) => s.splitLeaf);
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <PenLine className="w-7 h-7 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-medium text-foreground">No note open</h2>
      <p className="text-sm mt-1 max-w-sm">
        Pick a file from the tree on the left to open it in this pane. Sprint 2
        brings the CodeMirror Markdown editor with live preview.
      </p>
      <div className="flex gap-2 mt-4">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => splitLeaf(leafId, "horizontal")}
              >
                <SplitSquareVertical className="w-3.5 h-3.5" />
                Split right
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split this pane horizontally</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => splitLeaf(leafId, "vertical")}
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                Split down
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split this pane vertically</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function LeafContent({ leafId, activeTabId }: { leafId: string; activeTabId: string | null }) {
  const manifest = useVaultStore((s) => s.manifest);
  if (!activeTabId || !manifest) return <LeafEmptyState leafId={leafId} />;
  const node = manifest.nodes[activeTabId];
  if (!node || node.kind !== "file") return <LeafEmptyState leafId={leafId} />;
  return (
    <div className="h-full flex flex-col">
      {/* File title header, mimicking Obsidian's inline title */}
      <div className="px-10 py-6 shrink-0 group">
        <h1 className="text-3xl font-bold tracking-tight text-foreground/90 group-hover:text-foreground transition-colors">
          {node.name.replace(/\.md$/, "")}
        </h1>
      </div>
      {node.isMarkdown ? (
        <MarkdownEditorPane fileId={node.id} leafId={leafId} />
      ) : (
        <div className="flex-1 grid place-items-center p-8 text-sm text-muted-foreground text-center">
          {node.isImage
            ? "(Image preview arrives in Sprint 2.)"
            : node.isCanvas
            ? "(Canvas opens in Sprint 5.)"
            : "(Binary file — no preview.)"}
        </div>
      )}
    </div>
  );
}

export function EditorLeaf({ leaf }: { leaf: LeafNode }) {
  const workspace = useVaultStore((s) => s.workspace);
  const setActiveLeaf = useVaultStore((s) => s.setActiveLeaf);
  const splitLeaf = useVaultStore((s) => s.splitLeaf);
  const closeLeaf = useVaultStore((s) => s.closeLeaf);

  const isActive = workspace?.activeLeafId === leaf.id;
  const view = leaf.view;

  // Graph view: render full-pane graph, no tab strip.
  if (view.kind === "graph") {
    return (
      <div
        className={cn(
          "h-full flex flex-col bg-background min-w-0 relative",
          isActive && "ring-1 ring-inset ring-primary/30"
        )}
        onMouseDown={() => {
          if (!isActive) setActiveLeaf(leaf.id);
        }}
      >
        <GraphLeafHeader leafId={leaf.id} />
        <div className="flex-1 min-h-0">
          <GraphView />
        </div>
      </div>
    );
  }

  // Canvas view: render full-pane whiteboard, no tab strip.
  if (view.kind === "canvas") {
    return (
      <div
        className={cn(
          "h-full flex flex-col bg-background min-w-0 relative",
          isActive && "ring-1 ring-inset ring-primary/30"
        )}
        onMouseDown={() => {
          if (!isActive) setActiveLeaf(leaf.id);
        }}
      >
        <GraphLeafHeader leafId={leaf.id} label="Canvas" />
        <div className="flex-1 min-h-0">
          <CanvasView />
        </div>
      </div>
    );
  }

  const tabs = view.kind === "editor" ? view.tabs : [];
  const activeTabId = view.kind === "editor" ? view.activeTabId : null;

  return (
    <div
      className={cn(
        "h-full flex flex-col bg-background min-w-0 relative",
        isActive && "ring-1 ring-inset ring-primary/30"
      )}
      onMouseDown={() => {
        if (!isActive) setActiveLeaf(leaf.id);
      }}
    >
      {/* Leaf header: tab strip + split/close controls. */}
      <div className="flex items-stretch h-10 border-b bg-sidebar/50 pt-1 px-1 shrink-0">
        <div
          className="flex items-stretch overflow-x-auto overflow-y-hidden flex-1 min-w-0 no-scrollbar relative"
          role="tablist"
          onMouseDown={() => setActiveLeaf(leaf.id)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const dragFileId = e.dataTransfer.getData("text/tab-file-id");
            const dragLeafId = e.dataTransfer.getData("text/tab-leaf-id");
            if (!dragFileId || !dragLeafId || dragLeafId === leaf.id) return;
            // Dropped on the tab strip (not on a specific tab) - append at end
            const store = useVaultStore.getState();
            store.moveTab(dragLeafId, leaf.id, dragFileId);
          }}
        >
          {tabs.length === 0 ? (
            <div className="flex items-center px-3 text-xs text-muted-foreground italic">
              empty
            </div>
          ) : (
            tabs.map((t) => <TabChip key={t.fileId} leafId={leaf.id} tab={t} />)
          )}
        </div>
        <div className="flex items-center gap-1 px-2 shrink-0 border-b border-border ml-auto">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => splitLeaf(leaf.id, "horizontal")}
                  aria-label="Split right"
                >
                  <SplitSquareVertical className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split right</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => splitLeaf(leaf.id, "vertical")}
                  aria-label="Split down"
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split down</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => closeLeaf(leaf.id)}
                  aria-label="Close pane"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close this pane</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <LeafContent leafId={leaf.id} activeTabId={activeTabId} />
      </div>
    </div>
  );
}

/** Local leaf lookup so TabChip can subscribe to its own leaf reactively. */
function findLeafLocal(root: import("@/lib/workspace/types").WorkspaceNode, id: string): LeafNode | null {
  if (root.id === id) return root.type === "leaf" ? root : null;
  if (root.type !== "branch") return null;
  for (const c of root.children) {
    const r = findLeafLocal(c, id);
    if (r) return r;
  }
  return null;
}

/** Header for a graph/canvas-view leaf: just a label + split/close controls. */
function GraphLeafHeader({ leafId, label = "Graph View" }: { leafId: string; label?: string }) {
  const splitLeaf = useVaultStore((s) => s.splitLeaf);
  const closeLeaf = useVaultStore((s) => s.closeLeaf);
  return (
    <div className="flex items-stretch h-10 border-b bg-sidebar/50 pt-1 px-2 shrink-0">
      <div className="flex items-center px-3 text-sm font-medium text-muted-foreground flex-1 border-b border-border">
        {label}
      </div>
      <div className="flex items-center gap-1 px-1 shrink-0 border-b border-border">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => splitLeaf(leafId, "horizontal")}
                aria-label="Split right"
              >
                <SplitSquareVertical className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split right</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => closeLeaf(leafId)}
                aria-label="Close pane"
              >
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close this pane</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
