"use client";

import { useState, useMemo } from "react";
import { History, RotateCcw, Trash2, X, ArrowRight } from "lucide-react";
import { useActiveFileId, useVaultStore } from "@/store/vault-store";
import {
  getSnapshots,
  computeDiff,
  formatSnapshotTime,
  type Snapshot,
  type DiffLine,
} from "@/lib/history/snapshots";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SnapshotBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Snapshot browser — shows version history for the active note.
 *
 * Left: list of snapshots (newest first) with timestamps.
 * Right: visual diff between the selected snapshot and the current content.
 *
 * "Restore" button replaces the current content with the snapshot.
 */
export function SnapshotBrowser({ open, onOpenChange }: SnapshotBrowserProps) {
  const activeFileId = useActiveFileId();
  const contentCache = useVaultStore((s) => s.contentCache);
  const setContent = useVaultStore((s) => s.setContent);
  const manifest = useVaultStore((s) => s.manifest);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const snapshots = useMemo<Snapshot[]>(() => {
    if (!activeFileId) return [];
    return getSnapshots(activeFileId);
  }, [activeFileId, open]);

  const currentContent = activeFileId ? contentCache[activeFileId] ?? "" : "";

  const selectedSnapshot = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;

  const diff = useMemo<DiffLine[]>(() => {
    if (!selectedSnapshot) return [];
    return computeDiff(selectedSnapshot.content, currentContent);
  }, [selectedSnapshot, currentContent]);

  const handleRestore = () => {
    if (!selectedSnapshot || !activeFileId) return;
    setContent(activeFileId, selectedSnapshot.content, true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-4xl h-[600px]">
        <DialogTitle className="sr-only">Version History</DialogTitle>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="border-b px-4 py-2 flex items-center gap-2 shrink-0">
            <History className="w-4 h-4" />
            <span className="text-sm font-medium">Version History</span>
            {manifest && activeFileId && (
              <span className="text-xs text-muted-foreground">
                {manifest.nodes[activeFileId]?.name}
              </span>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOpenChange(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          {snapshots.length === 0 ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              No saved versions yet. Snapshots are created automatically when you save.
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex">
              {/* Snapshot list */}
              <div className="w-56 border-r shrink-0">
                <ScrollArea className="h-full">
                  <div className="p-2 space-y-1">
                    {snapshots.map((snap) => (
                      <button
                        key={snap.id}
                        onClick={() => setSelectedId(snap.id)}
                        className={cn(
                          "w-full text-left p-2 rounded-sm text-sm hover:bg-accent/50 transition-colors",
                          (selectedId ?? snapshots[0]?.id) === snap.id && "bg-accent"
                        )}
                      >
                        <div className="font-medium text-xs">
                          {formatSnapshotTime(snap.timestamp)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {snap.size} chars
                          {snap.label && ` · ${snap.label}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Diff view */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="border-b px-3 py-1.5 flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {selectedSnapshot && (
                      <>
                        <span className="text-red-500">− removed</span>
                        {" / "}
                        <span className="text-emerald-500">+ added</span>
                        {" vs current"}
                      </>
                    )}
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={handleRestore}
                    disabled={!selectedSnapshot}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restore this version
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="font-mono text-xs">
                    {diff.map((line, i) => (
                      <div
                        key={i}
                        className={cn(
                          "px-3 py-0.5",
                          line.type === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                          line.type === "removed" && "bg-red-500/10 text-red-700 dark:text-red-400",
                          line.type === "unchanged" && "text-muted-foreground"
                        )}
                      >
                        <span className="inline-block w-6 select-none opacity-40">
                          {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
