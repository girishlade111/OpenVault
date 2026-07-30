"use client";

import { Link2, FileText, ArrowRight } from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { useBacklinks } from "@/store/index-store";
import type { LinkEdge } from "@/lib/index/link-index";
import { ScrollArea } from "@/components/ui/scroll-area";
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
 * Backlinks panel — shows incoming links to the active note.
 *
 * For each backlink, displays:
 *  • The source note name (click to open).
 *  • The raw link target (so you can see the alias/heading used).
 *  • A snippet of the context around the link (future enhancement).
 *
 * Live-updates as the user types in other notes (via the index store's
 * incremental re-index).
 */
export function BacklinksPanel() {
  const activeFileId = useActiveFileId();
  const backlinks = useBacklinks(activeFileId);
  const manifest = useVaultStore((s) => s.manifest);
  const openFile = useVaultStore((s) => s.openFile);

  if (!activeFileId) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Open a note to see its backlinks.
      </p>
    );
  }

  if (backlinks.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground italic">
        No backlinks yet. Other notes will appear here when they link to this
        one with [[WikiLinks]].
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <div className="p-2 space-y-1">
        {backlinks.map((edge, i) => (
          <BacklinkRow
            key={`${edge.source}-${edge.offset}-${i}`}
            edge={edge}
            manifest={manifest}
            onOpen={(fileId) => openFile(fileId)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function BacklinkRow({
  edge,
  manifest,
  onOpen,
}: {
  edge: LinkEdge;
  manifest: ReturnType<typeof useVaultStore.getState>["manifest"];
  onOpen: (fileId: string) => void;
}) {
  const sourceNode = manifest?.nodes[edge.source];
  if (!sourceNode) return null;

  return (
    <div
      className="group flex items-start gap-1.5 px-2 py-1.5 rounded-sm hover:bg-accent/50 cursor-pointer text-sm"
      onClick={() => onOpen(edge.source)}
    >
      <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium">{sourceNode.name}</span>
          {edge.alias && (
            <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
              alias
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
          <span className="truncate">{sourceNode.path}</span>
        </div>
      </div>
      <ArrowRight className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </div>
  );
}

/** Header with the backlink count, for the right sidebar. */
export function BacklinksHeader() {
  const activeFileId = useActiveFileId();
  const backlinks = useBacklinks(activeFileId);
  const count = backlinks.length;
  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium">
      <Link2 className="w-3.5 h-3.5" />
      Backlinks
      {count > 0 && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
          {count}
        </Badge>
      )}
    </div>
  );
}
