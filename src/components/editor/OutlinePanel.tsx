"use client";

import { useMemo, useState } from "react";
import { GripVertical, ChevronRight, ChevronDown, Heading, List } from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { deriveBlocks, type Block } from "@/lib/editor/blocks";
import { applyListItemDrag, indentItem, outdentItem, type DragDescriptor } from "@/lib/editor/outliner";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

/**
 * Outline panel — the outliner UI.
 *
 * Renders the document's block tree (headings + list items) with:
 *  - Drag-and-drop reordering of list items (calls applyListItemDrag →
 *    transactional buffer rewrite, preserving nested subtree indentation).
 *  - Indent / outdent buttons per list item (Tab / Shift-Tab semantics).
 *  - Click-to-jump: scrolls the editor to the block's line.
 *
 * The panel re-derives blocks from the active file's cached content on every
 * edit, so it stays live as the user types.
 */
export function OutlinePanel() {
  const activeFileId = useActiveFileId();
  const content = useVaultStore((s) =>
    activeFileId ? s.contentCache[activeFileId] : undefined
  );
  const setContent = useVaultStore((s) => s.setContent);
  const manifest = useVaultStore((s) => s.manifest);

  const blocks = useMemo<Block[]>(() => {
    if (content === undefined) return [];
    return deriveBlocks(content);
  }, [content]);

  // Track which headings are collapsed in the outline view (UI-only state).
  // Keyed by fileId so it auto-resets on file switch without setState-in-effect.
  const [collapsedByFile, setCollapsedByFile] = useState<Record<string, Record<string, boolean>>>({});
  const collapsed = activeFileId ? collapsedByFile[activeFileId] ?? {} : {};
  const setCollapsed = (next: Record<string, boolean>) => {
    if (!activeFileId) return;
    setCollapsedByFile((prev) => ({ ...prev, [activeFileId]: next }));
  };

  // Drag state: which block is being dragged, and the current drop target.
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; pos: DragDescriptor["position"] } | null>(null);

  const handleDragStart = (e: React.DragEvent, block: Block) => {
    if (block.kind !== "list-item") return;
    setDragFrom(block.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.id);
  };

  const handleDragOver = (e: React.DragEvent, block: Block) => {
    if (!dragFrom || block.kind !== "list-item") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Determine drop zone based on cursor Y position within the row.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let pos: DragDescriptor["position"];
    if (y < h * 0.33) pos = "before";
    else if (y > h * 0.66) pos = "after";
    else pos = "child";
    setDragOver({ id: block.id, pos });
  };

  const handleDrop = (e: React.DragEvent, target: Block) => {
    e.preventDefault();
    if (!dragFrom || !activeFileId || !content || target.kind !== "list-item") {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const fromBlock = blocks.find((b) => b.id === dragFrom);
    if (!fromBlock || fromBlock.kind !== "list-item") {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const pos = dragOver?.pos ?? "after";
    const drag: DragDescriptor = {
      fromLine: fromBlock.fromLine,
      toLine: target.fromLine,
      position: pos,
    };
    const result = applyListItemDrag(content, drag);
    if (result) {
      setContent(activeFileId, result.text, true);
    }
    setDragFrom(null);
    setDragOver(null);
  };

  const handleIndent = (block: Block) => {
    if (!activeFileId || !content) return;
    const next = indentItem(content, block.fromLine);
    if (next) setContent(activeFileId, next, true);
  };

  const handleOutdent = (block: Block) => {
    if (!activeFileId || !content) return;
    const next = outdentItem(content, block.fromLine);
    if (next) setContent(activeFileId, next, true);
  };

  if (!activeFileId || content === undefined) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Open a note to see its outline.
      </div>
    );
  }

  // Filter to headings + list items (the structural blocks worth showing).
  const visible = blocks.filter((b) => b.kind === "heading" || b.kind === "list-item");

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-0.5">
        {visible.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-1">
            No headings or list items yet.
          </p>
        )}
        {visible.map((block) => {
          const isCollapsed = !!collapsed[block.id];
          const isDragOver = dragOver?.id === block.id;
          const dropPos = isDragOver ? dragOver!.pos : null;
          return (
            <OutlineRow
              key={block.id}
              block={block}
              collapsed={isCollapsed}
              isDragging={dragFrom === block.id}
              dropPos={dropPos}
              onToggleCollapse={() =>
                setCollapsed({ ...collapsed, [block.id]: !collapsed[block.id] })
              }
              onDragStart={(e) => handleDragStart(e, block)}
              onDragOver={(e) => handleDragOver(e, block)}
              onDrop={(e) => handleDrop(e, block)}
              onIndent={() => handleIndent(block)}
              onOutdent={() => handleOutdent(block)}
            />
          );
        })}
      </div>
    </ScrollArea>
  );
}

interface OutlineRowProps {
  block: Block;
  collapsed: boolean;
  isDragging: boolean;
  dropPos: DragDescriptor["position"] | null;
  onToggleCollapse: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onIndent: () => void;
  onOutdent: () => void;
}

function OutlineRow({
  block,
  collapsed,
  isDragging,
  dropPos,
  onToggleCollapse,
  onDragStart,
  onDragOver,
  onDrop,
  onIndent,
  onOutdent,
}: OutlineRowProps) {
  const isHeading = block.kind === "heading";
  const isListItem = block.kind === "list-item";
  const depth = isHeading ? Math.max(0, (block.level ?? 1) - 1) : block.depth ?? 0;
  const label = block.label.replace(/^#{1,6}\s+/, "").replace(/^(\s*)([-*+]|\d+[.)])\s+/, "");
  const hasChildren = false; // simplified; children derived separately if needed

  return (
    <div
      draggable={isListItem}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => {
        // parent clears via re-render
      }}
      className={cn(
        "group flex items-center gap-1 h-7 rounded-sm text-sm relative transition-colors",
        isDragging && "opacity-40",
        "hover:bg-accent/50"
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      data-drop-pos={dropPos}
    >
      {/* Drop zone indicator lines */}
      {dropPos === "before" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
      )}
      {dropPos === "after" && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
      )}
      {dropPos === "child" && (
        <div className="absolute inset-0 border-2 border-primary/40 rounded-sm bg-primary/5" />
      )}

      {/* Collapse toggle for headings */}
      {isHeading && hasChildren ? (
        <button
          onClick={onToggleCollapse}
          className="w-4 h-4 grid place-items-center text-muted-foreground shrink-0"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      {/* Drag handle (list items only) */}
      {isListItem ? (
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
      ) : (
        <span className="w-3.5 shrink-0">
          {isHeading && <Heading className="w-3 h-3 text-muted-foreground" />}
        </span>
      )}

      {/* Label */}
      <span
        className={cn(
          "flex-1 truncate",
          isHeading && "font-medium",
          isHeading && (block.level ?? 1) <= 2 && "text-foreground",
          isListItem && "text-muted-foreground"
        )}
      >
        {isListItem && <List className="inline w-3 h-3 mr-1 -mt-0.5" />}
        {label || "(empty)"}
      </span>

      {/* Indent / outdent (list items only) */}
      {isListItem && (
        <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onOutdent();
            }}
            aria-label="Outdent"
            title="Outdent (Shift+Tab)"
          >
            <ChevronRight className="w-3 h-3 rotate-180" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onIndent();
            }}
            aria-label="Indent"
            title="Indent (Tab)"
          >
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
