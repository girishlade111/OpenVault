"use client";

import { useState, useCallback, useEffect } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  Share2,
  CalendarDays,
  Sun,
  Moon,
  History,
  LayoutGrid,
} from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { WorkspaceRenderer } from "@/components/workspace/WorkspaceRenderer";
import { StatusBar } from "./StatusBar";
import { useVaultWatcher } from "./useVaultWatcher";
import { useIndexBridge } from "@/lib/index/use-index-bridge";
import { useBuiltinCommands } from "@/lib/automation/use-builtin-commands";
import { CommandPalette } from "@/components/automation/CommandPalette";
import { SnapshotBrowser } from "@/components/history/SnapshotBrowser";
import { getDailyNotePath, DEFAULT_DAILY_CONFIG } from "@/lib/automation/daily-notes";
import { useThemeStore } from "@/lib/theme/theme-store";

function TopBar({
  onOpenPalette,
  onOpenSnapshots,
  onOpenCanvas,
}: {
  onOpenPalette: () => void;
  onOpenSnapshots: () => void;
  onOpenCanvas: () => void;
}) {
  const handle = useVaultStore((s) => s.handle);
  const toggleRight = useVaultStore((s) => s.toggleRightSidebar);
  const rightOpen = useVaultStore((s) => s.rightSidebarOpen);
  const closeVault = useVaultStore((s) => s.closeVault);
  const openGraphView = useVaultStore((s) => s.openGraphView);
  const manifest = useVaultStore((s) => s.manifest);
  const openFile = useVaultStore((s) => s.openFile);
  const themeToggle = useThemeStore((s) => s.toggle);
  const themeResolved = useThemeStore((s) => s.resolved);

  const openDailyNote = () => {
    if (!manifest) return;
    const path = getDailyNotePath(DEFAULT_DAILY_CONFIG);
    const id = manifest.pathIndex[path];
    if (id) {
      openFile(id);
    } else {
      onOpenPalette();
    }
  };

  return (
    <header className="h-10 shrink-0 border-b bg-background flex items-center px-3 gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="w-5 h-5 rounded bg-primary/15 text-primary grid place-items-center text-[10px] font-bold">
          ◇
        </div>
        <span className="text-sm font-medium truncate">
          {handle?.name ?? "Vault"}
        </span>
      </div>
      <div className="flex-1" />
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={openDailyNote}
            >
              <CalendarDays className="w-3.5 h-3.5 mr-1" />
              Daily
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open today's daily note</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onOpenPalette}
            >
              <span className="text-[10px] opacity-60 mr-1">⌘P</span>
              Commands
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open command palette (Cmd+P)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => openGraphView()}
            >
              <Share2 className="w-3.5 h-3.5 mr-1" />
              Graph
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open graph view</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onOpenCanvas}
            >
              <LayoutGrid className="w-3.5 h-3.5 mr-1" />
              Canvas
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open canvas (whiteboard)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onOpenSnapshots}
            >
              <History className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Version history</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={themeToggle}
            >
              {themeResolved === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle {themeResolved === "dark" ? "light" : "dark"} mode</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={toggleRight}
            >
              {rightOpen ? (
                <>
                  <PanelRightClose className="w-3.5 h-3.5 mr-1" />
                  Hide inspector
                </>
              ) : (
                <>
                  <PanelRightOpen className="w-3.5 h-3.5 mr-1" />
                  Show inspector
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle right inspector</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={closeVault}
      >
        Close vault
      </Button>
    </header>
  );
}

export function VaultApp() {
  const leftOpen = useVaultStore((s) => s.leftSidebarOpen);
  const rightOpen = useVaultStore((s) => s.rightSidebarOpen);
  const workspace = useVaultStore((s) => s.workspace);
  const openCanvasView = useVaultStore((s) => s.openCanvasView);
  const initTheme = useThemeStore((s) => s.init);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  useVaultWatcher();
  useIndexBridge();
  useBuiltinCommands(togglePalette);

  // Initialize theme on mount.
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TopBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSnapshots={() => setSnapshotsOpen(true)}
        onOpenCanvas={() => openCanvasView()}
      />
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" autoSaveId="vault-layout">
          {leftOpen && (
            <>
              <ResizablePanel
                id="left"
                order={1}
                defaultSize={20}
                minSize={12}
                maxSize={40}
              >
                <LeftSidebar />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel id="center" order={2} minSize={30}>
            {workspace ? (
              <WorkspaceRenderer node={workspace.root} />
            ) : (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                Loading workspace…
              </div>
            )}
          </ResizablePanel>

          {rightOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel
                id="right"
                order={3}
                defaultSize={22}
                minSize={14}
                maxSize={45}
              >
                <RightSidebar />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <StatusBar />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SnapshotBrowser open={snapshotsOpen} onOpenChange={setSnapshotsOpen} />
    </div>
  );
}
