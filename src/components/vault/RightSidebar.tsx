"use client";

import { Hash, ListTree, Sparkles, Maximize2 } from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { OutlinePanel } from "@/components/editor/OutlinePanel";
import { BacklinksPanel, BacklinksHeader } from "@/components/index/BacklinksPanel";
import {
  UnlinkedMentionsPanel,
  UnlinkedMentionsHeader,
} from "@/components/index/UnlinkedMentionsPanel";
import { LocalGraph } from "@/components/graph/LocalGraph";
import { useIndexStore } from "@/store/index-store";

/**
 * Right sidebar.
 *
 *  • Outline          — live block tree (Sprint 3).
 *  • Backlinks        — incoming links from the bidirectional index (Sprint 5).
 *  • Unlinked mentions — plain-text mentions of the note title (Sprint 5).
 *  • Tags             — tags in the active note (Sprint 5).
 *  • Local graph      — mini force-directed graph of the active note (Sprint 8).
 */
export function RightSidebar() {
  const activeFileId = useActiveFileId();
  const manifest = useVaultStore((s) => s.manifest);
  const index = useIndexStore((s) => s.index);
  const splitLeaf = useVaultStore((s) => s.splitLeaf);

  const node = activeFileId && manifest ? manifest.nodes[activeFileId] : null;

  // Get the active note's tags from the index.
  const tags = activeFileId && index ? index.metadata.get(activeFileId)?.tags ?? [] : [];

  return (
    <div className="h-full flex flex-col bg-muted/20">
      <div className="border-b px-3 py-2 flex items-center justify-between shrink-0">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {node ? node.name : "Inspector"}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Local graph — LIVE in Sprint 8 */}
          <div className="rounded-md border bg-background/60 overflow-hidden">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" />
                Local graph
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground"
                onClick={() => {
                  // Open full graph view by splitting the active leaf.
                  const ws = useVaultStore.getState().workspace;
                  if (ws?.activeLeafId) {
                    splitLeaf(ws.activeLeafId, "horizontal");
                  }
                }}
                aria-label="Open full graph"
                title="Open full graph view"
              >
                <Maximize2 className="w-3 h-3" />
              </Button>
            </div>
            <LocalGraph />
          </div>

          {/* Outline — LIVE since Sprint 3 */}
          <div className="rounded-md border bg-background/60">
            <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium">
              <ListTree className="w-3.5 h-3.5" />
              Outline
            </div>
            <div className="max-h-72 overflow-y-auto">
              <OutlinePanel />
            </div>
          </div>

          {/* Backlinks — LIVE in Sprint 5 */}
          <div className="rounded-md border bg-background/60">
            <BacklinksHeader />
            <BacklinksPanel />
          </div>

          {/* Unlinked mentions — LIVE in Sprint 5 */}
          <div className="rounded-md border bg-background/60">
            <UnlinkedMentionsHeader />
            <UnlinkedMentionsPanel />
          </div>

          {/* Tags — LIVE in Sprint 5 */}
          <div className="rounded-md border bg-background/60">
            <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium">
              <Hash className="w-3.5 h-3.5" />
              Tags
            </div>
            <div className="p-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground italic px-1 py-1">
                  No tags in this note.
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                  >
                    #{tag}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
