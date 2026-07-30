"use client";

import { useMemo, useState } from "react";
import { Play, Pause, Tag, FileWarning, Image as ImageIcon, Filter } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import { buildGraphLayout, stabilize, type GraphLayout } from "@/lib/graph/layout";
import { GraphCanvas } from "./GraphCanvas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
 * Controls: play/pause simulation, zoom in/out, reset.
 * Click a node → open that note.
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

  // Build (or rebuild) the layout when the index changes or filters toggle.
  const layout = useMemo<GraphLayout | null>(() => {
    if (!index || !manifest) return null;
    const layout = buildGraphLayout(index, labels);
    // Run initial stabilization for a settled layout.
    stabilize(layout, undefined, 200);
    return layout;
  
  }, [index, manifest, labels, resetNonce]);

  // Filter the visible nodes.
  const highlightedIds = useMemo(() => {
    if (!index || !manifest) return null;
    const visible = new Set<string>();
    for (const fileId of index.metadata.keys()) {
      const meta = index.metadata.get(fileId);
      const hasIncoming = (index.incoming.get(fileId)?.length ?? 0) > 0;
      const hasOutgoing = (index.outgoing.get(fileId)?.length ?? 0) > 0;
      const isOrphan = !hasIncoming && !hasOutgoing;
      if (isOrphan && !showOrphans) continue;
      if (!showTags && meta && meta.tags.length === 0 && !hasIncoming && !hasOutgoing) continue;
      visible.add(fileId);
    }
    return visible;
  }, [index, manifest, showOrphans, showTags]);

  if (!index || !manifest || !layout) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Building graph…
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setResetNonce((n) => n + 1)}
                aria-label="Reset layout"
              >
                <Filter className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset layout</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0">
        <GraphCanvas
          layout={layout}
          simulate={simulate}
          activeFileId={activeFileId}
          highlightedIds={highlightedIds}
          onNodeClick={(fileId) => openFile(fileId)}
        />
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded">
        Drag to pan · Scroll to zoom · Click a node to open
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
