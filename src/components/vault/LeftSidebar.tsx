"use client";

import { useState } from "react";
import { Search, PanelLeftClose, PanelLeftOpen, X, FilePlus, Star, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useSettingsStore } from "@/lib/settings/settings-store";
import { FileTree } from "./FileTree";
import { SearchPanel } from "@/components/search/SearchPanel";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function StarredNotes() {
  const starredNotes = useSettingsStore((s) => s.starredNotes);
  const manifest = useVaultStore((s) => s.manifest);
  const openFile = useVaultStore((s) => s.openFile);
  const [collapsed, setCollapsed] = useState(false);

  if (starredNotes.length === 0) return null;

  return (
    <div className="border-b">
      <button
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        <Star className="w-3 h-3 fill-current text-yellow-500" />
        <span>Starred</span>
        <span className="ml-auto text-muted-foreground/70">{starredNotes.length}</span>
      </button>
      {!collapsed && (
        <div className="pb-1">
          {starredNotes.map((fileId) => {
            const node = manifest?.nodes[fileId];
            if (!node) return null;
            return (
              <button
                key={fileId}
                className="flex items-center gap-1.5 w-full px-4 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onClick={() => openFile(fileId)}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LeftSidebar() {
  const toggle = useVaultStore((s) => s.toggleLeftSidebar);
  const createFile = useVaultStore((s) => s.createFile);
  const openFile = useVaultStore((s) => s.openFile);
  const manifest = useVaultStore((s) => s.manifest);
  const [searchMode, setSearchMode] = useState(false);

  const handleNewNote = () => {
    if (!manifest) return;
    // Create untitled note at root, incrementing name if needed
    let name = "Untitled.md";
    let counter = 1;
    while (manifest.pathIndex[name]) {
      name = `Untitled ${counter}.md`;
      counter++;
    }
    const newId = createFile(manifest.rootId, name);
    if (newId) openFile(newId);
  };

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
                onClick={handleNewNote}
                aria-label="New note"
              >
                <FilePlus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New note (Ctrl+N)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
      <div className="flex-1 min-h-0 flex flex-col">
        {searchMode ? (
          <ErrorBoundary label="Search">
            <SearchPanel onClose={() => setSearchMode(false)} />
          </ErrorBoundary>
        ) : (
          <>
            <StarredNotes />
            <div className="flex-1 min-h-0">
              <FileTree />
            </div>
          </>
        )}
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
