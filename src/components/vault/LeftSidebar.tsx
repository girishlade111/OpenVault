"use client";

import { useState } from "react";
import { Search, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { FileTree } from "./FileTree";
import { SearchPanel } from "@/components/search/SearchPanel";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function LeftSidebar() {
  const toggle = useVaultStore((s) => s.toggleLeftSidebar);
  const [searchMode, setSearchMode] = useState(false);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b px-2 py-2 flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => setSearchMode((v) => !v)}
          className={`flex-1 flex items-center gap-1.5 h-7 px-2 rounded text-sm transition-colors ${
            searchMode
              ? "bg-primary/10 text-primary"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
          }`}
          aria-label="Toggle search"
        >
          <Search className="w-3.5 h-3.5" />
          <span>Search</span>
        </button>
        {searchMode && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setSearchMode(false)}
            aria-label="Back to file tree"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={toggle}
                aria-label="Hide sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide sidebar</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex-1 min-h-0">
        {searchMode ? <SearchPanel onClose={() => setSearchMode(false)} /> : <FileTree />}
      </div>
    </div>
  );
}

/** Slim button bar that restores the left sidebar when collapsed. */
export function LeftSidebarReveal() {
  const toggle = useVaultStore((s) => s.toggleLeftSidebar);
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-6 p-0 rounded-none border-r"
            onClick={toggle}
            aria-label="Show sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Show sidebar</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
