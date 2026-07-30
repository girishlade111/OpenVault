/**
 * File System Access API helpers — the local-first backbone.
 *
 *  • `pickVaultDirectory()` — opens the native folder picker.
 *  • `verifyPermission()` — requests read/write permission, persists it.
 *  • `readFileText()` / `writeFileText()` — text I/O on a vault file.
 *  • `getEntryByPath()` — resolves a vault-relative path to a handle.
 *
 * Browser support: Chrome/Edge/Opera (and Chromium-based preview panels).
 * Safari/Firefox do not implement FSA; the caller must feature-detect via
 * `isFsAccessSupported()` and fall back to the in-memory demo vault.
 */

import type { FileId } from "./types";

export function isFsAccessSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      "function"
  );
}

// Minimal inline typings for the FS Access API (TS lib may not include them).
type FsPermissionMode = "read" | "readwrite";
type FsPermissionState = "granted" | "denied" | "prompt";

interface FsHandleBase {
  kind: "file" | "directory";
  name: string;
  queryPermission?(opts: { mode: FsPermissionMode }): Promise<FsPermissionState>;
  requestPermission?(opts: { mode: FsPermissionMode }): Promise<FsPermissionState>;
}
export interface FsDirHandle extends FsHandleBase {
  kind: "directory";
  values(): AsyncIterableIterator<FsFileHandle | FsDirHandle>;
  entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirHandle]>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}
export interface FsFileHandle extends FsHandleBase {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritableStream>;
}
interface FsWritableStream {
  write(data: string | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** Open the OS folder picker and return the chosen directory handle. */
export async function pickVaultDirectory(): Promise<FsDirHandle | null> {
  if (!isFsAccessSupported()) return null;
  try {
    const handle = await (
      window as unknown as {
        showDirectoryPicker: (opts?: { mode?: FsPermissionMode }) => Promise<FsDirHandle>;
      }
    ).showDirectoryPicker({ mode: "readwrite" });
    return handle;
  } catch (err) {
    // User cancelled — return null, not an error.
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Request persistent read/write permission. Returns true if granted. */
export async function verifyPermission(
  handle: FsDirHandle,
  readWrite = true
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const mode: FsPermissionMode = readWrite ? "readwrite" : "read";
  const queried = await handle.queryPermission({ mode });
  if (queried === "granted") return true;
  const requested = await handle.requestPermission({ mode });
  return requested === "granted";
}

/**
 * Persist the root directory handle to IndexedDB so a reload of the app can
 * re-open the same vault without re-prompting. (Permissions still need to be
 * re-verified, but the picker is skipped.)
 */
const IDB_DB = "vault-store";
const IDB_STORE = "root-handles";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function persistRootHandle(handle: FsDirHandle): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(handle, "root");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // non-fatal — next launch just re-prompts
  }
}

export async function loadPersistedRootHandle(): Promise<FsDirHandle | null> {
  try {
    const db = await idbOpen();
    const handle = await new Promise<FsDirHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get("root");
      req.onsuccess = () => resolve((req.result as FsDirHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearPersistedRootHandle(): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete("root");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}

/**
 * Resolve a vault-relative POSIX path (e.g. "Daily/2024-01-01.md") to a file
 * handle. Returns null if the path does not exist.
 */
export async function getEntryByPath(
  root: FsDirHandle,
  path: string
): Promise<FsFileHandle | FsDirHandle | null> {
  const parts = path.split("/").filter(Boolean);
  let current: FsFileHandle | FsDirHandle = root;
  for (const part of parts) {
    if (current.kind !== "directory") return null;
    try {
      current = await current.getFileHandle(part);
    } catch {
      try {
        current = await (current as unknown as {
          getDirectoryHandle: (n: string) => Promise<FsFileHandle | FsDirHandle>;
        }).getDirectoryHandle(part);
      } catch {
        return null;
      }
    }
  }
  return current;
}

/** Read a file's text content. Throws on missing files. */
export async function readFileText(root: FsDirHandle, path: string): Promise<string> {
  const entry = await getEntryByPath(root, path);
  if (!entry || entry.kind !== "file") {
    throw new Error(`File not found: ${path}`);
  }
  const file = await entry.getFile();
  return file.text();
}

/** Write text content to a file, creating it if missing. */
export async function writeFileText(root: FsDirHandle, path: string, text: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Cannot write to vault root");
  const fileName = parts.pop()!;
  let dir: FsDirHandle = root;
  for (const part of parts) {
    dir = await (dir as unknown as {
      getDirectoryHandle: (
        n: string,
        opts?: { create?: boolean }
      ) => Promise<FsDirHandle>;
    }).getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Stable id helper kept here for symmetry with FS-bound calls. */
export function handleIdFor(_handle: FsDirHandle): FileId | null {
  return null; // ids are path-based, not handle-based
}
