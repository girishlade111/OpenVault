/**
 * Stable internal ID generation.
 *
 * Why hash the path instead of using the raw path as the id?
 *  - Renames: when a file is renamed, its path changes but we want the
 *    editor/tab state keyed by something stable-ish. We DON'T claim true
 *    stability across renames (that requires content hashing + heuristics,
 *    handled in the link-index phase). For Phase 1 the id is a deterministic
 *    hash of the vault-relative POSIX path, which gives us:
 *      • Deterministic across reloads (same path → same id)
 *      • O(1) length, URL-safe
 *      • No collisions inside a single vault
 *  - Cross-vault uniqueness is irrelevant because only one vault is open
 *    at a time.
 *
 * The hash is FNV-1a 32-bit — tiny, dependency-free, good distribution for
 * short path strings. Output is base36.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(input: string): string {
  let hash = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Produce a stable id for a vault-relative POSIX path.
 * Path MUST be normalized (forward slashes, no leading slash, no trailing slash
 * except for root which is the empty string).
 */
export function makeFileId(vaultRelativePath: string): string {
  const normalized = vaultRelativePath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized === "") return "root";
  return fnv1a32(normalized);
}

/**
 * Derive a stable id for a *new* file the user is about to create, given a
 * parent folder id and a desired name. We can't hash the eventual path until
 * we know it, so this resolves the parent path first.
 *
 * NOTE: in Phase 1 we don't yet have a path resolver hooked up here; callers
 * pass the fully-qualified vault-relative path.
 */
export function makeFileIdFromPath(vaultRelativePath: string): string {
  return makeFileId(vaultRelativePath);
}
