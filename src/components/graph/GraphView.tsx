"use client";

import { useMemo, useState, useRef } from "react";
import { Play, Pause, Tag, FileWarning, Image as ImageIcon, Maximize, RotateCcw, Search } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import { buildGraphLayout, type GraphLayout } from "@/lib/graph/layout";
import { GraphCanvas, type GraphCanvasHandle } from "./GraphCanvas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Full-screen graph view.
 *
 * Renders the entire vault's link graph as a force-directed visualization.
 * Filter toggles: show/hide tags, attachments, orphan notes.
 * Controls: play/pause simulation, zoom in/out, reset, zoom-to-fit.
 * Click a node -> open that note.
 */
export function GraphView() {
  const manifest = useVaultStore((s) => s.manifest);
  const index = useIndexStore((s) => s.index);
  const openFile = useVaultStore((s) => s.openFile);
  const activeFileId = useVaultStore((s) => {
    // Derive active file id from the workspace tree.
    const ws = s.workspace;
    if (!ws || !ws.activeLeafId) return null;
    const leaf = findLeaf(ws.root, ws.activeLeafId);
    return leaf?.view.kind === "editor" ? leaf.view.activeTabId : null;
  });

  const [simulate, setSimulate] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [resetNonce, setResetNonce] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const graphCanvasRef = useRef<GraphCanvasHandle>(null);

  // Build labels map.
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    if (manifest) {
      for (const node of Object.values(manifest.nodes)) {
        if (node.kind === "file" && node.isMarkdown) {
          m.set(node.id, node.name.replace(/\.md$/i, ""));
        }
      }
    }
    return m;
  }, [manifest]);

  // Build filtered index BEFORE building layout so hidden nodes
  // are truly excluded from the graph (not just dimmed).
  const filteredIndex = useMemo(() => {
    if (!index || !manifest) return null;

    // Start with all indexed files
    const visibleIds = new Set<string>();
    for (const fileId of index.metadata.keys()) {
      const hasIncoming = (index.incoming.get(fileId)?.length ?? 0) > 0;
      const hasOutgoing = (index.outgoing.get(fileId)?.length ?? 0) > 0;
      const isOrphan = !hasIncoming && !hasOutgoing;

      // Filter: orphans
      if (isOrphan && !showOrphans) continue;

      // Filter: attachments (non-markdown files)
      const node = manifest.nodes[fileId];
      if (node && node.kind === "file" && !node.isMarkdown && !showAttachments) continue;

      visibleIds.add(fileId);
    }

    // Build a filtered version of the index
    return {
      ...index,
      outgoing: new Map(
        [...index.outgoing].filter(([id]) => visibleIds.has(id))
      ),
      incoming: new Map(
        [...index.incoming].filter(([id]) => visibleIds.has(id))
      ),
      metadata: new Map(
        [...index.metadata].filter(([id]) => visibleIds.has(id))
      ),
    };
  }, [index, manifest, showOrphans, showAttachments, showTags]);

  // Build (or rebuild) the layout from the filtered index.
  const layout = useMemo<GraphLayout | null>(() => {
    if (!filteredIndex || !manifest) return null;
    const l = buildGraphLayout(filteredIndex, labels);
    return l;
  }, [filteredIndex, manifest, labels, resetNonce]);

  // Compute highlighted node IDs from search query.
  const highlightedIds = useMemo<Set<string> | null>(() => {
    if (!searchQuery.trim() || !layout) return null;
    const query = searchQuery.toLowerCase();
    const ids = new Set<string>();
    for (const node of layout.nodes.values()) {
      if (node.label.toLowerCase().includes(query)) {
        ids.add(node.id);
      }
    }
    return ids.size > 0 ? ids : null;
  }, [searchQuery, layout]);

  const nodeColors = useMemo(() => {
    if (!index || !manifest) return new Map<string, string>();
    const map = new Map<string, string>();
    const palette = [
      "#ef4444", "#3b82f6", "#10b981", "#f59e0b",
      "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"
    ];
    const tagColors = new Map<string, string>();
    
    for (const fileId of index.metadata.keys()) {
      const meta = index.metadata.get(fileId);
      if (meta && meta.tags.length > 0) {
        const firstTag = meta.tags[0];
        if (!tagColors.has(firstTag)) {
          tagColors.set(firstTag, palette[tagColors.size % palette.length]);
        }
        map.set(fileId, tagColors.get(firstTag)!);
      }
    }
    return map;
  }, [index, manifest]);

  if (!index || !manifest || !layout) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Building graph...
      </div>
    );
  }

  const stats = {
    nodes: layout.nodes.size,
    edges: layout.edges.length,
    orphans: [...index.metadata.keys()].filter((id) => {
      const hasIncoming = (index.incoming.get(id)?.length ?? 0) > 0;
      const hasOutgoing = (index.outgoing.get(id)?.length ?? 0) > 0;
      return !hasIncoming && !hasOutgoing;
    }).length,
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Toolbar */}
      <div className="border-b px-3 py-1.5 flex items-center gap-2 shrink-0 bg-muted/20">
        <span className="text-xs font-medium">Graph View</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">
          {stats.nodes} nodes
        </Badge>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">
          {stats.edges} edges
        </Badge>
        {stats.orphans > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal text-amber-600">
            {stats.orphans} orphans
          </Badge>
        )}
        <div className="flex-1" />
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Filter nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-36 pl-7 text-xs"
          />
        </div>
        <TooltipProvider delayDuration={300}>
          <FilterToggle
            icon={<FileWarning className="w-3.5 h-3.5" />}
            label="Orphans"
            active={showOrphans}
            onClick={() => setShowOrphans((v) => !v)}
          />
          <FilterToggle
            icon={<Tag className="w-3.5 h-3.5" />}
            label="Tags"
            active={showTags}
            onClick={() => setShowTags((v) => !v)}
          />
          <FilterToggle
            icon={<ImageIcon className="w-3.5 h-3.5" />}
            label="Attachments"
            active={showAttachments}
            onClick={() => setShowAttachments((v) => !v)}
          />
          <div className="w-px h-5 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSimulate((v) => !v)}
                aria-label={simulate ? "Pause" : "Play"}
              >
                {simulate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{simulate ? "Pause simulation" : "Resume simulation"}</TooltipContent>
          </Tooltip>
          {/* Zoom-to-fit button using ref */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => graphCanvasRef.current?.zoomToFit()}
                aria-label="Zoom to fit"
              >
                <Maximize className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom to fit all nodes</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setResetNonce((n) => n + 1)}
                aria-label="Reset layout"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset layout</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex-1 min-h-0">
        <GraphCanvas
          ref={graphCanvasRef}
          layout={layout}
          simulate={simulate}
          activeFileId={activeFileId}
          highlightedIds={highlightedIds}
          nodeColors={nodeColors}
          onNodeClick={(fileId) => openFile(fileId)}
        />
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded">
        Drag to pan · Scroll to zoom · Click node to open · F to fit · +/- to zoom
      </div>
    </div>
  );
}

function FilterToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 gap-1 text-xs",
            active ? "text-foreground bg-accent" : "text-muted-foreground"
          )}
          onClick={onClick}
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{active ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}</TooltipContent>
    </Tooltip>
  );
}

/** Recursively find a leaf by id. */
function findLeaf(
  node: import("@/lib/workspace/types").WorkspaceNode,
  id: string
): import("@/lib/workspace/types").LeafNode | null {
  if (node.id === id) return node.type === "leaf" ? node : null;
  if (node.type !== "branch") return null;
  for (const c of node.children) {
    const r = findLeaf(c, id);
    if (r) return r;
  }
  return null;
}
