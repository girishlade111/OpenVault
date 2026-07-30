/**
 * Recursive directory walker.
 *
 * Takes a `FileSystemDirectoryHandle` (from `showDirectoryPicker()`) and
 * produces a flat `VaultManifest` of every non-ignored entry, with stable
 * ids, parent/child relationships, and quick counters.
 *
 * The walk is iterative (stack-based) instead of recursive to avoid blowing
 * the JS call stack on deep vaults. It is also cancellation-friendly: pass
 * an `AbortSignal` and the walk will stop at the next iteration boundary.
 */

import {
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  CANVAS_EXTENSIONS,
  type FileId,
  type VaultManifest,
  type VaultNode,
} from "./types";
import { makeFileId } from "./id";
import { isEditorTempFile, shouldIgnore } from "./filter";

import type { FsDirHandle as FsApiDirHandle, FsFileHandle as FsApiFileHandle } from "./fs";

/** Re-use the FsDirHandle type from fs.ts for consistency. */
type FsDirHandle = FsApiDirHandle;
type FsFileHandle = FsApiFileHandle;
type FsHandle = FsDirHandle | FsFileHandle;

function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function classify(ext: string | null) {
  return {
    isMarkdown: ext !== null && (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext),
    isImage: ext !== null && (IMAGE_EXTENSIONS as readonly string[]).includes(ext),
    isCanvas: ext !== null && (CANVAS_EXTENSIONS as readonly string[]).includes(ext),
  };
}

function joinPath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** Stack frame for the iterative walk. */
interface Frame {
  dir: FsDirHandle;
  parentId: FileId | null;
  parentPath: string;
}

export interface WalkOptions {
  signal?: AbortSignal;
  /** Called with progress (files processed so far). Throttle outside. */
  onProgress?: (count: number) => void;
}

/**
 * Walk a directory handle and return a complete manifest.
 * Throws if aborted.
 */
export async function walkVault(
  rootHandle: FsDirHandle,
  opts: WalkOptions = {}
): Promise<VaultManifest> {
  const nodes: Record<FileId, VaultNode> = {};
  const pathIndex: Record<string, FileId> = {};
  const counts = {
    files: 0,
    folders: 0,
    markdown: 0,
    images: 0,
    canvases: 0,
  };

  const rootPath = "";
  const rootId = makeFileId(rootPath);
  const rootNode: VaultNode = {
    id: rootId,
    name: rootHandle.name || "Vault",
    path: rootPath,
    kind: "folder",
    parentId: null,
    childIds: [],
    extension: null,
    size: 0,
    mtime: Date.now(),
    isMarkdown: false,
    isImage: false,
    isCanvas: false,
  };
  nodes[rootId] = rootNode;
  pathIndex[rootPath] = rootId;
  counts.folders = 1;

  const stack: Frame[] = [{ dir: rootHandle, parentId: null, parentPath: rootPath }];
  let processed = 0;

  while (stack.length > 0) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const frame = stack.pop()!;
    const parent = nodes[frame.parentId ?? rootId];

    const children: VaultNode[] = [];

    for await (const handle of frame.dir.values()) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const name = handle.name as string;
      if (shouldIgnore(name, handle.kind === "directory" ? "folder" : "file")) continue;
      if (handle.kind === "file" && isEditorTempFile(name)) continue;

      const relPath = joinPath(frame.parentPath, name);
      const id = makeFileId(relPath);

      if (handle.kind === "directory") {
        const node: VaultNode = {
          id,
          name,
          path: relPath,
          kind: "folder",
          parentId: parent.id,
          childIds: [],
          extension: null,
          size: 0,
          mtime: Date.now(),
          isMarkdown: false,
          isImage: false,
          isCanvas: false,
        };
        nodes[id] = node;
        pathIndex[relPath] = id;
        counts.folders++;
        children.push(node);
        stack.push({ dir: handle as FsDirHandle, parentId: id, parentPath: relPath });
      } else {
        // file — fetch metadata via getFile(). This is the slow path; the
        // manifest is built once per scan and incrementally updated after.
        let size = 0;
        let mtime = Date.now();
        try {
          const f = await (handle as FsFileHandle).getFile();
          size = f.size;
          mtime = f.lastModified;
        } catch {
          // permissions / race — fall back to defaults
        }
        const ext = extOf(name);
        const cls = classify(ext);
        const node: VaultNode = {
          id,
          name,
          path: relPath,
          kind: "file",
          parentId: parent.id,
          childIds: [],
          extension: ext,
          size,
          mtime,
          ...cls,
        };
        nodes[id] = node;
        pathIndex[relPath] = id;
        counts.files++;
        if (cls.isMarkdown) counts.markdown++;
        if (cls.isImage) counts.images++;
        if (cls.isCanvas) counts.canvases++;
        children.push(node);
      }

      processed++;
      if (processed % 25 === 0) opts.onProgress?.(processed);
    }

    // Sort: folders first, then alpha (case-insensitive).
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
    parent.childIds = children.map((c) => c.id);
  }

  opts.onProgress?.(processed);

  return {
    rootId,
    nodes,
    pathIndex,
    counts,
    scannedAt: Date.now(),
  };
}
