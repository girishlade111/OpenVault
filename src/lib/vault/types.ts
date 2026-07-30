/**
 * Vault core type definitions.
 *
 * A "Vault" is a user-chosen root directory on the local file system.
 * Everything inside it is plain text (.md) + standard asset files.
 * The app holds NO proprietary database — only a derived in-memory index.
 */

/** Stable internal identifier for a file or folder inside the vault. */
export type FileId = string;

/** Kind of entry the node represents in the tree. */
export type EntryKind = "file" | "folder";

/** Supported vault file extensions (lowercase, no dot). */
export const MARKDOWN_EXTENSIONS = ["md", "markdown"] as const;
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] as const;
export const CANVAS_EXTENSIONS = ["canvas"] as const;

/** A single node in the vault file tree. */
export interface VaultNode {
  /** Stable internal id (hash of vault-relative path). */
  id: FileId;
  /** Display name, e.g. "Daily Notes". */
  name: string;
  /** Vault-relative POSIX path, e.g. "Daily/2024-01-01.md". */
  path: string;
  /** Kind: file or folder. */
  kind: EntryKind;
  /** Parent node id, or null for the vault root. */
  parentId: FileId | null;
  /** Child ids (folders always sorted first, then files, both alpha). */
  childIds: FileId[];
  /** File extension (lowercase, no dot) for files; null for folders. */
  extension: string | null;
  /** Byte size for files (0 for folders). */
  size: number;
  /** Last-modified timestamp (ms epoch). */
  mtime: number;
  /** True if this is a markdown note. */
  isMarkdown: boolean;
  /** True if this is a binary image asset. */
  isImage: boolean;
  /** True if this is an Obsidian-style canvas file. */
  isCanvas: boolean;
}

/** Flat manifest of the entire vault, keyed by stable id. */
export interface VaultManifest {
  /** rootId === the vault root folder node id. */
  rootId: FileId;
  /** Every node by id. */
  nodes: Record<FileId, VaultNode>;
  /** Quick lookup: vault-relative path → id. */
  pathIndex: Record<string, FileId>;
  /** Counters for the status bar. */
  counts: {
    files: number;
    folders: number;
    markdown: number;
    images: number;
    canvases: number;
  };
  /** Timestamp of the last successful scan. */
  scannedAt: number;
}

/** What kind of vault backing store is active. */
export type VaultSourceKind =
  | "fs-access" // File System Access API (real local folder, Chrome/Edge)
  | "demo"; // In-memory seeded demo vault (fallback for unsupported browsers)

/** The live vault handle. Abstracts over the two source kinds. */
export interface VaultHandle {
  kind: VaultSourceKind;
  /** Human-readable name shown in the status bar. */
  name: string;
  /** True when the File System Access API directory handle is available. */
  hasFsAccess: boolean;
}

/** Result of a single external-change scan. */
export interface ScanDiff {
  added: FileId[];
  removed: FileId[];
  modified: FileId[];
  renamed: { from: FileId; to: FileId }[];
}
