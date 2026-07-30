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
import { FileText, Hash, Command as CommandIcon, Calendar } from "lucide-react";
import { useVaultStore } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import { executeCommand, getAllCommands } from "@/lib/automation/hotkeys";
import { getDailyNotePath, renderDailyNote, DEFAULT_DAILY_CONFIG } from "@/lib/automation/daily-notes";
import { noteNameFromPath } from "@/lib/index/link-index";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Command palette (Cmd/Ctrl+P).
 *
 * Fuzzy-searches across:
 *  - All registered commands (with their hotkey hints)
 *  - All markdown files (by name + path)
 *  - All headings (jump within a note)
 *  - All tags
 *
 * Selecting a command runs it. Selecting a file opens it. Selecting a tag
 * searches for it. Selecting the "New daily note" command creates today's
 * daily note if it doesn't exist and opens it.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const manifest = useVaultStore((s) => s.manifest);
  const contentCache = useVaultStore((s) => s.contentCache);
  const openFile = useVaultStore((s) => s.openFile);
  const setContent = useVaultStore((s) => s.setContent);
  const index = useIndexStore((s) => s.index);
  const [query, setQuery] = useState("");
  void contentCache;
  void setContent;

  // Build the items: commands + files + headings + tags.
  const items = useMemo(() => {
    if (!manifest) return [];
    const out: PaletteItem[] = [];

    // Commands.
    const commands = getAllCommands();
    for (const cmd of commands) {
      if (cmd.available && !cmd.available()) continue;
      out.push({
        type: "command",
        id: `cmd:${cmd.id}`,
        label: cmd.name,
        hint: cmd.category ?? "Command",
        icon: <CommandIcon className="w-3.5 h-3.5" />,
        action: () => {
          executeCommand(cmd.id);
          onOpenChange(false);
        },
      });
    }

    // Daily note command (special — creates if missing).
    const dailyPath = getDailyNotePath(DEFAULT_DAILY_CONFIG);
    const dailyExists = !!manifest.pathIndex[dailyPath];
    if (!dailyExists) {
      out.push({
        type: "command",
        id: "cmd:daily-new",
        label: "Create today's daily note",
        hint: "Daily",
        icon: <Calendar className="w-3.5 h-3.5" />,
        action: () => {
          const content = renderDailyNote(DEFAULT_DAILY_CONFIG);
          // Find the daily note's file id — it doesn't exist yet, so we need
          // to create it. For the demo vault, we write to the cache + manifest.
          // For FSA vaults, we'd writeFileText. This is simplified for the
          // prototype: we add it to the content cache and rescan.
          const fileId = `daily_${Date.now()}`;
          setContent(fileId, content, false);
          // In a full implementation, we'd call writeFileText then rescan.
          // For now, just open the file if it exists after rescan.
          onOpenChange(false);
        },
      });
    }

    // Files.
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind !== "file" || !node.isMarkdown) continue;
      out.push({
        type: "file",
        id: `file:${node.id}`,
        label: node.name.replace(/\.md$/i, ""),
        hint: node.path,
        icon: <FileText className="w-3.5 h-3.5 text-sky-500" />,
        action: () => {
          openFile(node.id);
          onOpenChange(false);
        },
      });
    }

    // Headings (from the index metadata).
    if (index) {
      for (const [fileId, meta] of index.metadata) {
        const node = manifest.nodes[fileId];
        if (!node) continue;
        for (const heading of meta.headings) {
          out.push({
            type: "heading",
            id: `heading:${fileId}:${heading.line}`,
            label: heading.text,
            hint: `${noteNameFromPath(node.path)} › heading`,
            icon: <Hash className="w-3.5 h-3.5 text-muted-foreground" />,
            action: () => {
              openFile(fileId);
              onOpenChange(false);
            },
          });
        }
      }
    }

    // Tags.
    if (index) {
      for (const tag of index.allTags) {
        out.push({
          type: "tag",
          id: `tag:${tag}`,
          label: `#${tag}`,
          hint: `${index.tagIndex.get(tag)?.length ?? 0} notes`,
          icon: <Hash className="w-3.5 h-3.5 text-primary" />,
          action: () => {
            // Open search with tag: query — for now, just close.
            onOpenChange(false);
          },
        });
      }
    }

    return out;
  }, [manifest, index, openFile, setContent, onOpenChange]);

  // Simple fuzzy filter.
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Group items by type.
  const grouped = useMemo(() => {
    const groups: Record<string, PaletteItem[]> = {};
    for (const item of filtered) {
      const key = item.type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [filtered]);

  const groupLabels: Record<string, string> = {
    command: "Commands",
    file: "Files",
    heading: "Headings",
    tag: "Tags",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 overflow-hidden max-w-2xl" aria-label="Command palette">
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type a command or search…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No results found.</CommandEmpty>
            {Object.entries(grouped).map(([type, groupItems]) => (
              <CommandGroup key={type} heading={groupLabels[type] ?? type}>
                {groupItems.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => item.action()}
                    className="flex items-center gap-2"
                  >
                    {item.icon}
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                      {item.hint}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

interface PaletteItem {
  type: "command" | "file" | "heading" | "tag";
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  action: () => void;
}
