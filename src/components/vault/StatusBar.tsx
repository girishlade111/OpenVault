"use client";

import { useEffect, useState } from "react";
import {
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
  CircleAlert,
  CircleCheck,
  HardDrive,
  CloudOff,
} from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { useIndexStats } from "@/store/index-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function WatcherIndicator() {
  const status = useVaultStore((s) => s.watcherStatus);
  const errorMsg = useVaultStore((s) => s.errorMsg);

  switch (status) {
    case "scanning":
      return (
        <Badge variant="outline" className="gap-1 font-normal">
          <Loader2 className="w-3 h-3 animate-spin" />
          Scanning…
        </Badge>
      );
    case "watching":
      return (
        <Badge variant="outline" className="gap-1 font-normal text-emerald-600 border-emerald-500/30">
          <CircleCheck className="w-3 h-3" />
          Watching
        </Badge>
      );
    case "error":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="gap-1 font-normal text-destructive border-destructive/30">
              <CircleAlert className="w-3 h-3" />
              Error
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{errorMsg ?? "Unknown error"}</TooltipContent>
        </Tooltip>
      );
    case "unsupported":
      return (
        <Badge variant="outline" className="gap-1 font-normal">
          <CloudOff className="w-3 h-3" />
          In-memory only
        </Badge>
      );
    default:
      return null;
  }
}

export function StatusBar() {
  const handle = useVaultStore((s) => s.handle);
  const manifest = useVaultStore((s) => s.manifest);
  const activeFileId = useActiveFileId();
  const indexStats = useIndexStats();
  const rescan = useVaultStore((s) => s.rescan);
  const toggleLeft = useVaultStore((s) => s.toggleLeftSidebar);
  const toggleRight = useVaultStore((s) => s.toggleRightSidebar);
  const leftOpen = useVaultStore((s) => s.leftSidebarOpen);
  const rightOpen = useVaultStore((s) => s.rightSidebarOpen);
  const lastScanAt = useVaultStore((s) => s.lastScanAt);

  // Live "x seconds ago" without subscribing to a ticking clock globally.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const activeNode =
    manifest && activeFileId ? manifest.nodes[activeFileId] : null;

  const scannedAgo = lastScanAt
    ? formatAgo(Date.now() - lastScanAt)
    : null;

  return (
    <TooltipProvider delayDuration={300}>
      <footer className="h-8 shrink-0 border-t bg-background flex items-center gap-2 px-3 text-xs text-muted-foreground select-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <HardDrive className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">
            {handle?.name ?? "No vault"}
          </span>
          {handle?.kind === "demo" && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1 font-normal">
              demo
            </Badge>
          )}
        </div>

        <span className="text-border">·</span>

        {manifest && (
          <div className="hidden sm:flex items-center gap-2">
            <span className="tabular-nums">
              {manifest.counts.markdown} notes
            </span>
            <span className="text-border">·</span>
            <span className="tabular-nums">
              {manifest.counts.files} files
            </span>
            {manifest.counts.images > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="tabular-nums">
                  {manifest.counts.images} images
                </span>
              </>
            )}
            {indexStats && indexStats.totalLinks > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="tabular-nums">
                  {indexStats.totalLinks} links
                </span>
              </>
            )}
          </div>
        )}

        <div className="flex-1" />

        {activeNode && (
          <span className="hidden md:inline truncate max-w-[40ch] text-muted-foreground/80">
            {activeNode.path}
          </span>
        )}

        {scannedAgo && (
          <span className="hidden lg:inline">scanned {scannedAgo} ago</span>
        )}

        <WatcherIndicator />

        {handle?.kind === "fs-access" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => void rescan()}
              >
                <RefreshCw className="w-3 h-3" />
                Rescan
              </Button>
            </TooltipTrigger>
            <TooltipContent>Re-scan vault for external changes</TooltipContent>
          </Tooltip>
        )}

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={toggleLeft}
                aria-label="Toggle file tree"
              >
                {leftOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle file tree</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={toggleRight}
                aria-label="Toggle right sidebar"
              >
                {rightOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle right sidebar</TooltipContent>
          </Tooltip>
        </div>
      </footer>
    </TooltipProvider>
  );
}

function formatAgo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
