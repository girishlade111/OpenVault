/**
 * Hidden-file / ignore filter for the vault.
 *
 * Mirrors Obsidian's behaviour: skip `.obsidian/` (our equivalent is
 * `.vault/` for app metadata), skip VCS dot-folders, skip OS noise.
 * User-visible dotfiles at the top level of the vault are still shown
 * (Obsidian's default) — only specific dot-folders are hidden.
 */

import type { EntryKind } from "./types";

/** Folder names that are always ignored anywhere in the vault. */
const IGNORED_FOLDER_NAMES = new Set<string>([
  ".git",
  ".svn",
  ".hg",
  ".vault", // our own app-metadata folder (Phase 9 settings)
  ".trash", // Obsidian-style soft-delete
  "node_modules",
]);

/** File names that are always ignored anywhere in the vault. */
const IGNORED_FILE_NAMES = new Set<string>([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  ".gitignore",
  ".gitattributes",
]);

/** Should this entry be skipped during the walk? */
export function shouldIgnore(name: string, kind: EntryKind): boolean {
  if (kind === "folder") {
    if (IGNORED_FOLDER_NAMES.has(name)) return true;
    // Obsidian hides all dot-folders by default. We mirror that for folders
    // only (not files) to keep e.g. `.bashrc` notes visible if the user wants.
    if (name.startsWith(".")) return true;
    return false;
  }
  if (IGNORED_FILE_NAMES.has(name)) return true;
  return false;
}

/** Is this filename likely a temp file from an editor (e.g. `~`-suffixed)? */
export function isEditorTempFile(name: string): boolean {
  return (
    name.endsWith("~") ||
    name.startsWith("#") ||
    name.startsWith(".#") ||
    name.endsWith(".swp") ||
    name.endsWith(".swo") ||
    name.endsWith(".tmp")
  );
}
