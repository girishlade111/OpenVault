"use client";

import { useMemo } from "react";
import { Link as LinkIcon, FileText } from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { noteNameFromPath } from "@/lib/index/link-index";
import { extractWikiLinks } from "@/lib/editor/custom-syntax";

/**
 * Unlinked mentions panel.
 *
 * For the active note's title, scans all OTHER notes for occurrences of the
 * title as plain text. If a note mentions the title but does NOT already link
 * it via [[WikiLink]], it's listed here with a "Link" button that converts
 * the plain-text mention into a formal [[WikiLink]].
 *
 * This is one of Obsidian's signature features — it surfaces implicit
 * connections the user didn't explicitly make.
 */
export function UnlinkedMentionsPanel() {
  const activeFileId = useActiveFileId();
  const manifest = useVaultStore((s) => s.manifest);
  const contentCache = useVaultStore((s) => s.contentCache);
  const setContent = useVaultStore((s) => s.setContent);
  const index = useIndexStore((s) => s.index);

  const activeNode = activeFileId && manifest ? manifest.nodes[activeFileId] : null;
  const activeNoteName = activeNode ? noteNameFromPath(activeNode.path) : "";

  // Compute unlinked mentions reactively.
  const mentions = useMemo(() => {
    if (!activeFileId || !manifest || !activeNoteName || activeNoteName.length < 3) {
      return [];
    }
    const results: {
      fileId: string;
      fileName: string;
      filePath: string;
      count: number;
      firstOffset: number;
    }[] = [];

    // Escape regex special chars in the note name.
    const escaped = activeNoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word-boundary match, case-sensitive (Obsidian default).
    const mentionRe = new RegExp(`(?<![\\w/])${escaped}(?![\\w/])`, "g");

    for (const node of Object.values(manifest.nodes)) {
      if (node.kind !== "file" || !node.isMarkdown) continue;
      if (node.id === activeFileId) continue; // skip self
      const content = contentCache[node.id];
      if (content === undefined) continue;

      // Skip if this file already links to the active note via WikiLink.
      const wikiLinks = extractWikiLinks(content);
      const alreadyLinked = wikiLinks.some(
        (wl) =>
          wl.noteName.toLowerCase() === activeNoteName.toLowerCase() ||
          wl.target.toLowerCase() === activeNoteName.toLowerCase()
      );
      if (alreadyLinked) continue;

      // Find plain-text mentions.
      const matches = [...content.matchAll(mentionRe)];
      if (matches.length === 0) continue;

      results.push({
        fileId: node.id,
        fileName: node.name,
        filePath: node.path,
        count: matches.length,
        firstOffset: matches[0].index!,
      });
    }

    return results.sort((a, b) => b.count - a.count);
  }, [activeFileId, activeNoteName, manifest, contentCache, index]);

  /** Convert a plain-text mention into a [[WikiLink]]. */
  const linkify = (fileId: string) => {
    const content = contentCache[fileId];
    if (content === undefined) return;
    const escaped = activeNoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionRe = new RegExp(`(?<![\\w/])${escaped}(?![\\w/])`, "g");
    // Replace the FIRST occurrence with a WikiLink.
    let replaced = false;
    const newText = content.replace(mentionRe, (match) => {
      if (replaced) return match;
      replaced = true;
      return `[[${activeNoteName}]]`;
    });
    if (replaced) {
      setContent(fileId, newText, true);
    }
  };

  if (!activeFileId) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Open a note to find unlinked mentions.
      </p>
    );
  }

  if (activeNoteName.length < 3) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground italic">
        Note name is too short to search for mentions (min 3 chars).
      </p>
    );
  }

  if (mentions.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground italic">
        No unlinked mentions of “{activeNoteName}” found.
      </p>
    );
  }

  return (
    <ScrollArea className="max-h-64">
      <div className="p-2 space-y-1">
        <p className="px-1 py-0.5 text-[10px] text-muted-foreground">
          {mentions.length} note{mentions.length !== 1 ? "s" : ""} mention
          “{activeNoteName}” without linking:
        </p>
        {mentions.map((m) => (
          <div
            key={m.fileId}
            className="group flex items-start gap-1.5 px-2 py-1.5 rounded-sm hover:bg-accent/50 text-sm"
          >
            <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="truncate font-medium">{m.fileName}</span>
                <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-normal">
                  ×{m.count}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {m.filePath}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                linkify(m.fileId);
              }}
            >
              <LinkIcon className="w-3 h-3" />
              Link
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/** Header for the unlinked mentions section. */
export function UnlinkedMentionsHeader() {
  const activeFileId = useActiveFileId();
  const manifest = useVaultStore((s) => s.manifest);
  const contentCache = useVaultStore((s) => s.contentCache);
  const activeNode = activeFileId && manifest ? manifest.nodes[activeFileId] : null;
  const activeNoteName = activeNode ? noteNameFromPath(activeNode.path) : "";

  const count = useMemo(() => {
    if (!activeFileId || !manifest || activeNoteName.length < 3) return 0;
    const escaped = activeNoteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionRe = new RegExp(`(?<![\\w/])${escaped}(?![\\w/])`, "g");
    let c = 0;
    for (const node of Object.values(manifest.nodes)) {
      if (node.kind !== "file" || !node.isMarkdown) continue;
      if (node.id === activeFileId) continue;
      const content = contentCache[node.id];
      if (content === undefined) continue;
      const wikiLinks = extractWikiLinks(content);
      const alreadyLinked = wikiLinks.some(
        (wl) =>
          wl.noteName.toLowerCase() === activeNoteName.toLowerCase()
      );
      if (alreadyLinked) continue;
      if (mentionRe.test(content)) c++;
    }
    return c;
  }, [activeFileId, activeNoteName, manifest, contentCache]);

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium">
      <LinkIcon className="w-3.5 h-3.5" />
      Unlinked mentions
      {count > 0 && (
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
          {count}
        </Badge>
      )}
    </div>
  );
}
