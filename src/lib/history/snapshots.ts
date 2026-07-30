/**
 * Local history / snapshot engine.
 *
 * Every time a file is saved, a compressed snapshot of its content is written
 * to a hidden `.vault/snapshots/<fileId>/<timestamp>.md` directory. The user
 * can browse historical versions and restore them via a visual diff.
 *
 * For demo vaults (in-memory), snapshots are stored in localStorage keyed by
 * fileId + timestamp.
 *
 * The snapshot store is DERIVED — it can be wiped without losing the actual
 * notes. It's a recovery mechanism, not a primary data store.
 */

import type { FileId } from "@/lib/vault/types";

/** A single historical snapshot of a file. */
export interface Snapshot {
  /** Unique id (fileId + timestamp). */
  id: string;
  /** The file this snapshot belongs to. */
  fileId: FileId;
  /** Display name of the file at snapshot time. */
  fileName: string;
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** The full content at snapshot time. */
  content: string;
  /** Byte size of the content. */
  size: number;
  /** Optional label (e.g. "before edit", "auto-save"). */
  label: string | null;
}

/** In-memory snapshot store (for demo vault + cache). */
const snapshotCache = new Map<FileId, Snapshot[]>();

const LS_PREFIX = "vault:snapshots:";

/** Save a snapshot of a file's content. */
export function saveSnapshot(
  fileId: FileId,
  fileName: string,
  content: string,
  label: string | null = null
): Snapshot {
  const timestamp = Date.now();
  const snapshot: Snapshot = {
    id: `${fileId}_${timestamp}`,
    fileId,
    fileName,
    timestamp,
    content,
    size: content.length,
    label,
  };

  // Add to in-memory cache.
  const arr = snapshotCache.get(fileId) ?? [];
  arr.push(snapshot);
  // Keep at most 50 snapshots per file.
  if (arr.length > 50) arr.shift();
  snapshotCache.set(fileId, arr);

  // Persist to localStorage for demo vaults.
  try {
    const key = `${LS_PREFIX}${fileId}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]") as Snapshot[];
    existing.push(snapshot);
    if (existing.length > 50) existing.shift();
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // quota / disabled — non-fatal
  }

  return snapshot;
}

/** Get all snapshots for a file, newest first. */
export function getSnapshots(fileId: FileId): Snapshot[] {
  // Try in-memory cache first.
  const cached = snapshotCache.get(fileId);
  if (cached && cached.length > 0) return [...cached].reverse();

  // Fall back to localStorage.
  try {
    const key = `${LS_PREFIX}${fileId}`;
    const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as Snapshot[];
    snapshotCache.set(fileId, stored);
    return [...stored].reverse();
  } catch {
    return [];
  }
}

/** Get a specific snapshot by id. */
export function getSnapshot(fileId: FileId, snapshotId: string): Snapshot | null {
  const snapshots = getSnapshots(fileId);
  return snapshots.find((s) => s.id === snapshotId) ?? null;
}

/** Delete a snapshot. */
export function deleteSnapshot(fileId: FileId, snapshotId: string): void {
  const arr = snapshotCache.get(fileId) ?? [];
  const filtered = arr.filter((s) => s.id !== snapshotId);
  snapshotCache.set(fileId, filtered);
  try {
    const key = `${LS_PREFIX}${fileId}`;
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

/** Clear all snapshots for a file. */
export function clearSnapshots(fileId: FileId): void {
  snapshotCache.delete(fileId);
  try {
    localStorage.removeItem(`${LS_PREFIX}${fileId}`);
  } catch {
    // ignore
  }
}

/**
 * Compute a simple line-level diff between two texts.
 * Returns arrays of added/removed/unchanged lines for visual display.
 */
export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

export function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff (O(n*m) — fine for typical note sizes).
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build the diff.
  let i = m;
  let j = n;
  const temp: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ type: "unchanged", text: oldLines[i - 1], oldLineNum: i, newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: "added", text: newLines[j - 1], oldLineNum: null, newLineNum: j });
      j--;
    } else {
      temp.push({ type: "removed", text: oldLines[i - 1], oldLineNum: i, newLineNum: null });
      i--;
    }
  }

  temp.reverse();
  return temp;
}

/** Format a timestamp for display. */
export function formatSnapshotTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
