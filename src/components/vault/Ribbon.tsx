import {
  PanelLeftClose,
  PanelLeftOpen,
  CalendarDays,
  Share2,
  LayoutGrid,
  History,
  Sun,
  Moon,
  Settings,
  Search
} from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useThemeStore } from "@/lib/theme/theme-store";
import { getDailyNotePath, DEFAULT_DAILY_CONFIG } from "@/lib/automation/daily-notes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Ribbon({
  onOpenPalette,
  onOpenSnapshots,
  onOpenCanvas,
  onOpenSettings,
}: {
  onOpenPalette: () => void;
  onOpenSnapshots: () => void;
  onOpenCanvas: () => void;
  onOpenSettings: () => void;
}) {
  const leftOpen = useVaultStore((s) => s.leftSidebarOpen);
  const toggleLeft = useVaultStore((s) => s.toggleLeftSidebar);
  const openGraphView = useVaultStore((s) => s.openGraphView);
  const openFile = useVaultStore((s) => s.openFile);
  const manifest = useVaultStore((s) => s.manifest);
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
    <div className="w-12 shrink-0 border-r bg-sidebar flex flex-col items-center py-3 gap-3 z-10">
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary grid place-items-center font-bold mb-2">
        <span className="text-sm">◇</span>
      </div>

      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleLeft}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              {leftOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle sidebar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenPalette}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Search className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Search & Commands</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openGraphView}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open graph view</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenCanvas}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open canvas</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openDailyNote}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <CalendarDays className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Open today's daily note</TooltipContent>
        </Tooltip>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenSnapshots}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Version history</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={themeToggle}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              {themeResolved === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle theme</TooltipContent>
        </Tooltip>
        
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenSettings}
              className="w-10 h-10 flex items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
