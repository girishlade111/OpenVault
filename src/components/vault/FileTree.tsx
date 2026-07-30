"use client";

import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  File as FileIcon,
} from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import type { VaultNode } from "@/lib/vault/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Icon for a file node based on its kind. */
function nodeIcon(node: VaultNode, expanded: boolean) {
  if (node.kind === "folder") {
    return expanded ? (
      <FolderOpen className="w-4 h-4 text-amber-500" />
    ) : (
      <Folder className="w-4 h-4 text-amber-500" />
    );
  }
  if (node.isMarkdown) return <FileText className="w-4 h-4 text-sky-500" />;
  if (node.isImage) return <ImageIcon className="w-4 h-4 text-emerald-500" />;
  if (node.isCanvas) return <LayoutGrid className="w-4 h-4 text-violet-500" />;
  return <FileIcon className="w-4 h-4 text-muted-foreground" />;
}

interface RowProps {
  node: VaultNode;
  depth: number;
}

function TreeRow({ node, depth }: RowProps) {
  const manifest = useVaultStore((s) => s.manifest);
  const collapsed = useVaultStore((s) => s.collapsedFolders);
  const activeFileId = useActiveFileId();
  const toggleFolder = useVaultStore((s) => s.toggleFolderCollapsed);
  const openFile = useVaultStore((s) => s.openFile);

  if (!manifest) return null;

  const isFolder = node.kind === "folder";
  const isCollapsed = !!collapsed[node.id];
  const isActive = !isFolder && activeFileId === node.id;

  const handleClick = () => {
    if (isFolder) toggleFolder(node.id);
    else openFile(node.id);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-1.5 h-7 pr-2 text-sm rounded-sm hover:bg-accent/60 transition-colors text-left",
          isActive && "bg-accent text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={node.path}
        aria-current={isActive ? "page" : undefined}
      >
        {isFolder ? (
          isCollapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {nodeIcon(node, !isCollapsed)}
        <span className="truncate flex-1">{node.name}</span>
        {isFolder && node.childIds.length > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {node.childIds.length}
          </span>
        )}
      </button>
      {isFolder && !isCollapsed && (
        <>
          {node.childIds
            .map((cid) => manifest.nodes[cid])
            .filter(Boolean)
            .map((child) => (
              <TreeRow key={child.id} node={child} depth={depth + 1} />
            ))}
        </>
      )}
    </>
  );
}

export function FileTree() {
  const manifest = useVaultStore((s) => s.manifest);

  if (!manifest) return null;
  const root = manifest.nodes[manifest.rootId];
  if (!root) return null;

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        <TreeRow node={root} depth={0} />
      </div>
    </ScrollArea>
  );
}
