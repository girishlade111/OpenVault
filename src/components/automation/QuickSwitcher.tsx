"use client";

import { useState, useMemo } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Clock } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";

interface QuickSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Quick Switcher (Ctrl+O).
 *
 * A file-only fuzzy search dialog. Shows recent files first, then all
 * matching notes ranked by relevance. Unlike the command palette, this
 * only searches file names and paths - no commands, headings, or tags.
 */
export function QuickSwitcher({ open, onOpenChange }: QuickSwitcherProps) {
  const manifest = useVaultStore((s) => s.manifest);
  const recentFiles = useVaultStore((s) => s.recentFiles);
  const openFile = useVaultStore((s) => s.openFile);
  const [query, setQuery] = useState("");

  // Build file items
  const allFiles = useMemo(() => {
    if (!manifest) return [];
    return Object.values(manifest.nodes)
      .filter((n) => n.kind === "file" && n.isMarkdown)
      .map((n) => ({
        id: n.id,
        name: n.name.replace(/\.md$/i, ""),
        path: n.path,
      }));
  }, [manifest]);

  // Recent files (valid ones only)
  const recentItems = useMemo(() => {
    if (!manifest) return [];
    return recentFiles
      .map((id) => manifest.nodes[id])
      .filter((n) => n && n.kind === "file" && n.isMarkdown)
      .map((n) => ({
        id: n.id,
        name: n.name.replace(/\.md$/i, ""),
        path: n.path,
      }));
  }, [manifest, recentFiles]);

  // Fuzzy filter and rank
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Show recent files first, then all files
      const recentIds = new Set(recentItems.map((r) => r.id));
      const rest = allFiles.filter((f) => !recentIds.has(f.id));
      return { recent: recentItems, files: rest };
    }

    const q = query.toLowerCase();
    const scored = allFiles
      .map((f) => {
        const nameMatch = f.name.toLowerCase().indexOf(q);
        const pathMatch = f.path.toLowerCase().indexOf(q);
        // Score: exact name start = best, name contains = good, path contains = ok
        let score = 0;
        if (nameMatch === 0) score = 100;
        else if (nameMatch > 0) score = 80;
        else if (pathMatch >= 0) score = 50;
        else score = -1; // no match
        return { ...f, score };
      })
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score);

    return { recent: [], files: scored };
  }, [query, allFiles, recentItems]);

  const handleSelect = (fileId: string) => {
    openFile(fileId);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQuery(""); }}>
      <DialogContent className="p-0 overflow-hidden max-w-xl" aria-label="Quick switcher">
        <DialogTitle className="sr-only">Quick Switcher</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type to search files..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No files found.</CommandEmpty>
            {filtered.recent.length > 0 && (
              <CommandGroup heading="Recent">
                {filtered.recent.map((item) => (
                  <CommandItem
                    key={`recent:${item.id}`}
                    value={`recent:${item.id}`}
                    onSelect={() => handleSelect(item.id)}
                    className="flex items-center gap-2"
                  >
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{item.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                      {item.path}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filtered.files.length > 0 && (
              <CommandGroup heading={query.trim() ? "Matches" : "All files"}>
                {filtered.files.map((item) => (
                  <CommandItem
                    key={`file:${item.id}`}
                    value={`file:${item.id}`}
                    onSelect={() => handleSelect(item.id)}
                    className="flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-500" />
                    <span className="flex-1 truncate">{item.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                      {item.path}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
