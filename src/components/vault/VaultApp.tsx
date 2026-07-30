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
import { QuickSwitcher } from "@/components/automation/QuickSwitcher";
import { SnapshotBrowser } from "@/components/history/SnapshotBrowser";
import { getDailyNotePath, DEFAULT_DAILY_CONFIG } from "@/lib/automation/daily-notes";
import { useThemeStore } from "@/lib/theme/theme-store";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { Ribbon } from "./Ribbon";

export function VaultApp() {
  const leftOpen = useVaultStore((s) => s.leftSidebarOpen);
  const rightOpen = useVaultStore((s) => s.rightSidebarOpen);
  const workspace = useVaultStore((s) => s.workspace);
  const openCanvasView = useVaultStore((s) => s.openCanvasView);
  const vaultName = useVaultStore((s) => s.handle?.name ?? 'OpenVault');
  const initTheme = useThemeStore((s) => s.init);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  const toggleSwitcher = useCallback(() => setSwitcherOpen((v) => !v), []);
  useVaultWatcher();
  useIndexBridge();
  useBuiltinCommands(togglePalette, toggleSwitcher);

  // Initialize theme on mount.
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <Ribbon
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSnapshots={() => setSnapshotsOpen(true)}
        onOpenCanvas={() => openCanvasView()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Title bar drag region for Electron frameless window (harmless in browsers) */}
        <div
          className="h-8 flex items-center px-4 shrink-0 bg-sidebar border-b select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="text-xs text-muted-foreground truncate">
            {vaultName}
          </span>
        </div>
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
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <QuickSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
      <SnapshotBrowser open={snapshotsOpen} onOpenChange={setSnapshotsOpen} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
