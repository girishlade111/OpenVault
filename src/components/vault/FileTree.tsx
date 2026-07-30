"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  File as FileIcon,
  Filter,
  ArrowDownAZ,
  ArrowUpAZ,
  Clock,
  X,
} from "lucide-react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import type { VaultNode } from "@/lib/vault/types";
import type { FileId } from "@/lib/vault/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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

// --- Inline Input Component ------------------------------------------------

function InlineInput({
  defaultValue,
  onSubmit,
  onCancel,
  placeholder,
}: {
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select name without extension
    const dotIdx = defaultValue.lastIndexOf(".");
    if (dotIdx > 0) {
      el.setSelectionRange(0, dotIdx);
    } else {
      el.select();
    }
  }, [defaultValue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = inputRef.current?.value.trim();
      if (val) onSubmit(val);
      else onCancel();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={defaultValue}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const val = inputRef.current?.value.trim();
        if (val && val !== defaultValue) onSubmit(val);
        else onCancel();
      }}
      placeholder={placeholder}
      className="h-6 w-full px-1 text-sm bg-input border border-ring rounded-sm outline-none"
    />
  );
}

// --- Drag-and-Drop state ---------------------------------------------------

let draggedNodeId: FileId | null = null;

// --- TreeRow ---------------------------------------------------------------

interface RowProps {
  node: VaultNode;
  depth: number;
  filter: string;
  renamingId: FileId | null;
  setRenamingId: (id: FileId | null) => void;
  creatingIn: FileId | null;
  creatingKind: "file" | "folder" | null;
  setCreatingIn: (id: FileId | null) => void;
  setCreatingKind: (kind: "file" | "folder" | null) => void;
  onRequestDelete: (id: FileId) => void;
}

const TreeRow = memo(function TreeRow({
  node,
  depth,
  filter,
  renamingId,
  setRenamingId,
  creatingIn,
  creatingKind,
  setCreatingIn,
  setCreatingKind,
  onRequestDelete,
}: RowProps) {
  const manifest = useVaultStore((s) => s.manifest);
  const collapsed = useVaultStore((s) => s.collapsedFolders);
  const sortMode = useVaultStore((s) => s.sortMode);
  const activeFileId = useActiveFileId();
  const toggleFolder = useVaultStore((s) => s.toggleFolderCollapsed);
  const openFile = useVaultStore((s) => s.openFile);
  const renameNode = useVaultStore((s) => s.renameNode);
  const createFile = useVaultStore((s) => s.createFile);
  const createFolder = useVaultStore((s) => s.createFolder);
  const moveNode = useVaultStore((s) => s.moveNode);

  const [dropTarget, setDropTarget] = useState<"above" | "inside" | "below" | null>(null);

  // Determine visible children, applying filter and sort
  const getVisibleChildren = useCallback(() => {
    if (!manifest || node.kind !== "folder") return [];
    let children = node.childIds
      .map((cid) => manifest.nodes[cid])
      .filter(Boolean);

    // Apply sorting
    children = [...children].sort((a, b) => {
      // Always folders first
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      switch (sortMode) {
        case "name-desc":
          return b.name.localeCompare(a.name, undefined, { sensitivity: "base", numeric: true });
        case "mtime-desc":
          return b.mtime - a.mtime;
        case "mtime-asc":
          return a.mtime - b.mtime;
        case "ctime-desc":
          return b.mtime - a.mtime; // Use mtime as proxy for ctime
        case "name-asc":
        default:
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      }
    });

    return children;
  }, [manifest, node.kind, node.childIds, sortMode]);

  // Check if this node or its descendants match the filter
  const matchesFilter = useCallback(
    (n: VaultNode): boolean => {
      if (!filter || !manifest) return true;
      const lowerFilter = filter.toLowerCase();
      if (n.name.toLowerCase().includes(lowerFilter)) return true;
      if (n.kind === "folder") {
        return n.childIds.some((cid) => {
          const child = manifest.nodes[cid];
          if (!child) return false;
          // Inline recursive check to avoid self-reference issue
          const checkChild = (c: VaultNode): boolean => {
            if (c.name.toLowerCase().includes(lowerFilter)) return true;
            if (c.kind === "folder") {
              return c.childIds.some((id) => {
                const gc = manifest.nodes[id];
                return gc ? checkChild(gc) : false;
              });
            }
            return false;
          };
          return checkChild(child);
        });
      }
      return false;
    },
    [filter, manifest]
  );

  if (!manifest) return null;

  const isFolder = node.kind === "folder";
  const isCollapsed = !!collapsed[node.id];
  const isActive = !isFolder && activeFileId === node.id;
  const isRenaming = renamingId === node.id;
  const isCreatingHere = creatingIn === node.id;

  // Skip nodes that don't match filter
  if (filter && !matchesFilter(node)) return null;

  const handleClick = () => {
    if (isRenaming) return;
    if (isFolder) toggleFolder(node.id);
    else openFile(node.id);
  };

  // --- Drag events ---
  const handleDragStart = (e: DragEvent<HTMLButtonElement>) => {
    draggedNodeId = node.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
  };

  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!draggedNodeId || draggedNodeId === node.id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    if (isFolder) {
      if (y < height * 0.25) setDropTarget("above");
      else if (y > height * 0.75) setDropTarget("below");
      else setDropTarget("inside");
    } else {
      if (y < height * 0.5) setDropTarget("above");
      else setDropTarget("below");
    }
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDropTarget(null);
    if (!draggedNodeId || draggedNodeId === node.id) return;

    if (dropTarget === "inside" && isFolder) {
      // Move into this folder
      moveNode(draggedNodeId, node.id);
    } else {
      // Move to same parent as this node (reorder)
      const targetParentId = node.parentId;
      if (targetParentId) {
        moveNode(draggedNodeId, targetParentId);
      }
    }
    draggedNodeId = null;
  };

  const handleDragEnd = () => {
    draggedNodeId = null;
    setDropTarget(null);
  };

  // --- Rename handling ---
  const handleRenameSubmit = (newName: string) => {
    if (newName && newName !== node.name) {
      renameNode(node.id, newName);
    }
    setRenamingId(null);
  };

  // --- Create handling ---
  const handleCreateSubmit = (name: string) => {
    if (!name) {
      setCreatingIn(null);
      setCreatingKind(null);
      return;
    }
    if (creatingKind === "folder") {
      createFolder(node.id, name);
    } else {
      const finalName = name.includes(".") ? name : `${name}.md`;
      const newId = createFile(node.id, finalName);
      if (newId) openFile(newId);
    }
    setCreatingIn(null);
    setCreatingKind(null);
  };

  const visibleChildren = getVisibleChildren();

  return (
    <>
      {dropTarget === "above" && (
        <div
          className="h-0.5 bg-primary rounded mx-1"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            draggable={!isRenaming && node.parentId !== null}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            className={cn(
              "w-full flex items-center gap-1.5 h-7 pr-2 text-sm rounded-sm hover:bg-accent/60 transition-colors text-left",
              isActive && "bg-accent text-accent-foreground",
              dropTarget === "inside" && "ring-1 ring-primary bg-primary/10"
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
            {isRenaming ? (
              <InlineInput
                defaultValue={node.name}
                onSubmit={handleRenameSubmit}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span className="truncate flex-1">{node.name}</span>
            )}
            {isFolder && !isRenaming && node.childIds.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {node.childIds.length}
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {!isFolder && (
            <ContextMenuItem onClick={() => openFile(node.id)}>
              Open
            </ContextMenuItem>
          )}
          {isFolder && (
            <>
              <ContextMenuItem
                onClick={() => {
                  setCreatingIn(node.id);
                  setCreatingKind("file");
                  // Expand folder if collapsed
                  if (isCollapsed) toggleFolder(node.id);
                }}
              >
                New Note
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setCreatingIn(node.id);
                  setCreatingKind("folder");
                  if (isCollapsed) toggleFolder(node.id);
                }}
              >
                New Folder
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          {node.parentId !== null && (
            <>
              <ContextMenuItem onClick={() => setRenamingId(node.id)}>
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive"
                onClick={() => onRequestDelete(node.id)}
              >
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {dropTarget === "below" && !isFolder && (
        <div
          className="h-0.5 bg-primary rounded mx-1"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}
      {isFolder && !isCollapsed && (
        <>
          {isCreatingHere && (
            <div
              className="flex items-center gap-1.5 h-7 pr-2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
            >
              <span className="w-3.5 shrink-0" />
              {creatingKind === "folder" ? (
                <Folder className="w-4 h-4 text-amber-500" />
              ) : (
                <FileText className="w-4 h-4 text-sky-500" />
              )}
              <InlineInput
                defaultValue={creatingKind === "folder" ? "New Folder" : "Untitled.md"}
                onSubmit={handleCreateSubmit}
                onCancel={() => {
                  setCreatingIn(null);
                  setCreatingKind(null);
                }}
                placeholder={creatingKind === "folder" ? "Folder name" : "Note name"}
              />
            </div>
          )}
          {visibleChildren.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              creatingIn={creatingIn}
              creatingKind={creatingKind}
              setCreatingIn={setCreatingIn}
              setCreatingKind={setCreatingKind}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </>
      )}
      {isFolder && !isCollapsed && dropTarget === "below" && (
        <div
          className="h-0.5 bg-primary rounded mx-1"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
        />
      )}
    </>
  );
});

// --- Sort Dropdown ---------------------------------------------------------

function SortDropdown() {
  const sortMode = useVaultStore((s) => s.sortMode);
  const setSortMode = useVaultStore((s) => s.setSortMode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          aria-label="Sort files"
        >
          {sortMode.startsWith("name") ? (
            sortMode === "name-asc" ? (
              <ArrowDownAZ className="w-3.5 h-3.5" />
            ) : (
              <ArrowUpAZ className="w-3.5 h-3.5" />
            )
          ) : (
            <Clock className="w-3.5 h-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          onClick={() => setSortMode("name-asc")}
          className={cn(sortMode === "name-asc" && "bg-accent")}
        >
          Name (A-Z)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setSortMode("name-desc")}
          className={cn(sortMode === "name-desc" && "bg-accent")}
        >
          Name (Z-A)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setSortMode("mtime-desc")}
          className={cn(sortMode === "mtime-desc" && "bg-accent")}
        >
          Modified (newest)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setSortMode("mtime-asc")}
          className={cn(sortMode === "mtime-asc" && "bg-accent")}
        >
          Modified (oldest)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setSortMode("ctime-desc")}
          className={cn(sortMode === "ctime-desc" && "bg-accent")}
        >
          Created (newest)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Main FileTree Component -----------------------------------------------

export function FileTree() {
  const manifest = useVaultStore((s) => s.manifest);
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [renamingId, setRenamingId] = useState<FileId | null>(null);
  const [creatingIn, setCreatingIn] = useState<FileId | null>(null);
  const [creatingKind, setCreatingKind] = useState<"file" | "folder" | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<FileId | null>(null);
  const deleteNode = useVaultStore((s) => s.deleteNode);

  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showFilter) filterInputRef.current?.focus();
  }, [showFilter]);

  if (!manifest) return null;
  const root = manifest.nodes[manifest.rootId];
  if (!root) return null;

  const deleteTarget = deleteTargetId ? manifest.nodes[deleteTargetId] : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header with filter toggle and sort */}
      <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-6 w-6 p-0", showFilter && "bg-accent")}
          onClick={() => {
            setShowFilter((v) => !v);
            if (showFilter) setFilter("");
          }}
          aria-label="Filter files"
        >
          <Filter className="w-3.5 h-3.5" />
        </Button>
        <SortDropdown />
        {showFilter && (
          <div className="flex-1 flex items-center gap-1">
            <input
              ref={filterInputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="h-6 flex-1 px-1.5 text-xs bg-input border border-border rounded-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {filter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => setFilter("")}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
          <TreeRow
            node={root}
            depth={0}
            filter={filter}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            creatingIn={creatingIn}
            creatingKind={creatingKind}
            setCreatingIn={setCreatingIn}
            setCreatingKind={setCreatingKind}
            onRequestDelete={setDeleteTargetId}
          />
        </div>
      </ScrollArea>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.kind === "folder" ? "folder" : "file"}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
              {deleteTarget?.kind === "folder" && " This will delete all files inside it."}
              {" "}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTargetId) deleteNode(deleteTargetId);
                setDeleteTargetId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
