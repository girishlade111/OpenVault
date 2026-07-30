/**
 * Bidirectional link index — the "brain" of the vault.
 *
 * This is an in-memory graph database built from the plain-text .md files.
 * It maintains TWO adjacency maps so both "what does this note link to?" and
 * "what links to this note?" are O(1) lookups:
 *
 *   outgoing: Map<fileId, Edge[]>   — links FROM this file
 *   incoming: Map<fileId, Edge[]>   — links TO this file (backlinks)
 *
 * The index is DERIVED — it can be wiped and rebuilt from the .md files at
 * any time. There is no proprietary database; this is just a cache.
 *
 * Link resolution: WikiLink targets like `[[Note Name]]` or `[[folder/Note]]`
 * are resolved to file IDs by matching against the vault manifest's path index
 * and a note-name → fileId lookup table (so `[[Zettelkasten]]` resolves to
 * `Concepts/Zettelkasten.md` even without the folder prefix).
 */

import type { FileId, VaultManifest, VaultNode } from "@/lib/vault/types";
import type { WikiLinkRef, TagRef, Frontmatter } from "@/lib/editor/custom-syntax";
import {
  extractWikiLinks,
  extractTags,
  extractFrontmatter,
} from "@/lib/editor/custom-syntax";
import { deriveBlocks } from "@/lib/editor/blocks";

/** A single directed edge in the link graph. */
export interface LinkEdge {
  /** Source file id (the note containing the link). */
  source: FileId;
  /** Target file id (the note being linked to), or null if unresolved. */
  target: FileId | null;
  /** The raw link target text (e.g. "Concepts/MOC", "Note#heading"). */
  rawTarget: string;
  /** The note-name portion (before any `#`). */
  noteName: string;
  /** Heading anchor, if any. */
  heading: string | null;
  /** Block reference id, if any. */
  blockId: string | null;
  /** Alias text, if any. */
  alias: string | null;
  /** True if this is an embed (transclusion). */
  embed: boolean;
  /** Character offset of the link in the source file. */
  offset: number;
  /** True if the target resolved to an existing file. */
  resolved: boolean;
}

/** Per-file metadata extracted during indexing. */
export interface FileMetadata {
  fileId: FileId;
  /** All outgoing links from this file. */
  links: LinkEdge[];
  /** All tags used in this file (deduplicated, lowercase). */
  tags: string[];
  /** Parsed frontmatter, or null if none. */
  frontmatter: Frontmatter | null;
  /** Heading texts in order (for outline + heading-link resolution). */
  headings: { text: string; level: number; line: number }[];
  /** Word count of the body (excluding frontmatter). */
  wordCount: number;
  /** Timestamp of the content this metadata was built from. */
  indexedAt: number;
}

/** The complete link index. */
export interface LinkIndex {
  /** outgoing: fileId → edges originating from that file. */
  outgoing: Map<FileId, LinkEdge[]>;
  /** incoming: fileId → edges targeting that file (backlinks). */
  incoming: Map<FileId, LinkEdge[]>;
  /** Per-file metadata. */
  metadata: Map<FileId, FileMetadata>;
  /** noteName (lowercase) → fileIds that match that name. */
  nameIndex: Map<string, FileId[]>;
  /** tag (lowercase) → fileIds that use that tag. */
  tagIndex: Map<string, FileId[]>;
  /** All tags seen across the vault, sorted. */
  allTags: string[];
  /** Total link count (for stats). */
  totalLinks: number;
  /** Timestamp of the last full rebuild. */
  builtAt: number;
}

/** An empty link index. */
export function emptyLinkIndex(): LinkIndex {
  return {
    outgoing: new Map(),
    incoming: new Map(),
    metadata: new Map(),
    nameIndex: new Map(),
    tagIndex: new Map(),
    allTags: [],
    totalLinks: 0,
    builtAt: 0,
  };
}

// --- note-name resolution --------------------------------------------------

/**
 * Build a lookup table: noteName (lowercase, without extension) → fileIds.
 * Multiple files can share the same note name (e.g. two "index.md" in
 * different folders); the resolver returns all matches and the caller picks.
 */
export function buildNameIndex(manifest: VaultManifest): Map<string, FileId[]> {
  const index = new Map<string, FileId[]>();
  for (const node of Object.values(manifest.nodes)) {
    if (node.kind !== "file" || !node.isMarkdown) continue;
    const name = noteNameFromPath(node.path).toLowerCase();
    const arr = index.get(name);
    if (arr) arr.push(node.id);
    else index.set(name, [node.id]);
  }
  return index;
}

/** Extract the note name from a path: "Concepts/MOC.md" → "MOC". */
export function noteNameFromPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * Resolve a WikiLink target to a file ID.
 *
 * Resolution order:
 *  1. Exact path match: "Concepts/MOC" → "Concepts/MOC.md"
 *  2. Note-name match: "MOC" → any file named "MOC.md"
 *  3. Path-prefix match: "Daily/2024-01-01" → "Daily/2024-01-01.md"
 *
 * Returns null if no match. If multiple matches, prefers exact path.
 */
export function resolveLink(
  target: string,
  nameIndex: Map<string, FileId[]>,
  manifest: VaultManifest
): FileId | null {
  if (!target) return null;
  const cleanTarget = target.trim();

  // 1. Exact path match (with or without .md extension).
  const withMd = cleanTarget.endsWith(".md") ? cleanTarget : cleanTarget + ".md";
  const exactId = manifest.pathIndex[withMd];
  if (exactId) return exactId;

  // 2. Note-name match.
  const noteName = noteNameFromPath(cleanTarget).toLowerCase();
  const matches = nameIndex.get(noteName);
  if (matches && matches.length > 0) {
    return matches[0]; // first match wins; could be ambiguous
  }

  // 3. Try the target as-is against the path index (maybe includes folder).
  const directId = manifest.pathIndex[cleanTarget];
  if (directId) return directId;

  return null;
}

// --- single-file indexing --------------------------------------------------

/**
 * Index a single file's content: extract links, tags, frontmatter, headings.
 * Returns the file metadata + outgoing edges (the incoming map is built by
 * the caller from all files' outgoing edges).
 */
export function indexFile(
  fileId: FileId,
  content: string,
  nameIndex: Map<string, FileId[]>,
  manifest: VaultManifest
): FileMetadata {
  const wikiLinks: WikiLinkRef[] = extractWikiLinks(content);
  const tags: TagRef[] = extractTags(content);
  const frontmatter = extractFrontmatter(content);
  const blocks = deriveBlocks(content);

  // Build outgoing edges with resolution.
  const links: LinkEdge[] = wikiLinks.map((wl) => {
    const target = resolveLink(wl.noteName, nameIndex, manifest);
    return {
      source: fileId,
      target,
      rawTarget: wl.target,
      noteName: wl.noteName,
      heading: wl.heading,
      blockId: wl.blockId,
      alias: wl.alias,
      embed: wl.embed,
      offset: wl.from,
      resolved: target !== null,
    };
  });

  // Deduplicate tags (lowercase).
  const tagSet = new Set<string>();
  for (const t of tags) tagSet.add(t.tag.toLowerCase());
  // Also collect frontmatter tags.
  if (frontmatter?.valid) {
    const fmTags = frontmatter.data.tags;
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) tagSet.add(String(t).toLowerCase());
    } else if (typeof fmTags === "string") {
      for (const t of String(fmTags).split(",")) tagSet.add(t.trim().toLowerCase());
    }
  }

  // Headings.
  const headings = blocks
    .filter((b) => b.kind === "heading" && b.level !== undefined)
    .map((b) => ({
      text: b.label.replace(/^#{1,6}\s+/, ""),
      level: b.level!,
      line: b.fromLine,
    }));

  // Word count (body only, excluding frontmatter).
  const body = frontmatter ? content.slice(frontmatter.to) : content;
  const wordCount = body
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  return {
    fileId,
    links,
    tags: [...tagSet].sort(),
    frontmatter,
    headings,
    wordCount,
    indexedAt: Date.now(),
  };
}

// --- full vault indexing ---------------------------------------------------

/**
 * Build a complete link index from the vault manifest + content cache.
 * This is the "cold start" path — runs on vault open.
 */
export function buildLinkIndex(
  manifest: VaultManifest,
  contentCache: Record<FileId, string>
): LinkIndex {
  const index = emptyLinkIndex();
  index.nameIndex = buildNameIndex(manifest);

  // Phase 1: index each file's metadata + outgoing edges.
  for (const node of Object.values(manifest.nodes)) {
    if (node.kind !== "file" || !node.isMarkdown) continue;
    const content = contentCache[node.id];
    if (content === undefined) continue;
    const meta = indexFile(node.id, content, index.nameIndex, manifest);
    index.metadata.set(node.id, meta);
    index.outgoing.set(node.id, meta.links);
  }

  // Phase 2: build incoming map from outgoing edges.
  for (const [sourceId, edges] of index.outgoing) {
    for (const edge of edges) {
      if (edge.target === null) continue;
      const arr = index.incoming.get(edge.target);
      if (arr) arr.push(edge);
      else index.incoming.set(edge.target, [edge]);
    }
  }

  // Phase 3: build tag index.
  for (const [fileId, meta] of index.metadata) {
    for (const tag of meta.tags) {
      const arr = index.tagIndex.get(tag);
      if (arr) arr.push(fileId);
      else index.tagIndex.set(tag, [fileId]);
    }
  }
  index.allTags = [...index.tagIndex.keys()].sort();

  // Stats.
  index.totalLinks = [...index.outgoing.values()].reduce(
    (sum, edges) => sum + edges.length,
    0
  );
  index.builtAt = Date.now();

  return index;
}

// --- incremental update ----------------------------------------------------

/**
 * Incrementally re-index a single file after an edit. Updates the outgoing
 * map for that file, patches the incoming map (remove old edges from this
 * source, add new ones), and refreshes the tag index for this file.
 *
 * This is O(edges) for this file, NOT O(vault) — the whole point.
 */
export function incrementalReindex(
  index: LinkIndex,
  fileId: FileId,
  content: string,
  manifest: VaultManifest
): LinkIndex {
  // Build the new metadata for this file.
  const meta = indexFile(fileId, content, index.nameIndex, manifest);

  // Remove old outgoing edges from the incoming map.
  const oldEdges = index.outgoing.get(fileId) ?? [];
  for (const edge of oldEdges) {
    if (edge.target === null) continue;
    const arr = index.incoming.get(edge.target);
    if (!arr) continue;
    const filtered = arr.filter((e) => e.source !== fileId);
    if (filtered.length > 0) index.incoming.set(edge.target, filtered);
    else index.incoming.delete(edge.target);
  }

  // Remove old tags for this file from the tag index.
  const oldMeta = index.metadata.get(fileId);
  if (oldMeta) {
    for (const tag of oldMeta.tags) {
      const arr = index.tagIndex.get(tag);
      if (!arr) continue;
      const filtered = arr.filter((id) => id !== fileId);
      if (filtered.length > 0) index.tagIndex.set(tag, filtered);
      else index.tagIndex.delete(tag);
    }
  }

  // Add new outgoing edges to the incoming map.
  for (const edge of meta.links) {
    if (edge.target === null) continue;
    const arr = index.incoming.get(edge.target);
    if (arr) arr.push(edge);
    else index.incoming.set(edge.target, [edge]);
  }

  // Add new tags.
  for (const tag of meta.tags) {
    const arr = index.tagIndex.get(tag);
    if (arr) {
      if (!arr.includes(fileId)) arr.push(fileId);
    } else {
      index.tagIndex.set(tag, [fileId]);
    }
  }

  // Update metadata + outgoing.
  index.metadata.set(fileId, meta);
  index.outgoing.set(fileId, meta.links);
  index.allTags = [...index.tagIndex.keys()].sort();
  index.totalLinks = [...index.outgoing.values()].reduce(
    (sum, edges) => sum + edges.length,
    0
  );

  return index;
}

/** Remove a file from the index (when deleted). */
export function removeFileFromIndex(index: LinkIndex, fileId: FileId): LinkIndex {
  const oldEdges = index.outgoing.get(fileId) ?? [];
  for (const edge of oldEdges) {
    if (edge.target === null) continue;
    const arr = index.incoming.get(edge.target);
    if (!arr) continue;
    const filtered = arr.filter((e) => e.source !== fileId);
    if (filtered.length > 0) index.incoming.set(edge.target, filtered);
    else index.incoming.delete(edge.target);
  }
  const oldMeta = index.metadata.get(fileId);
  if (oldMeta) {
    for (const tag of oldMeta.tags) {
      const arr = index.tagIndex.get(tag);
      if (!arr) continue;
      const filtered = arr.filter((id) => id !== fileId);
      if (filtered.length > 0) index.tagIndex.set(tag, filtered);
      else index.tagIndex.delete(tag);
    }
  }
  index.outgoing.delete(fileId);
  index.metadata.delete(fileId);
  // Also clean incoming entries that pointed TO this file (orphaned backlinks).
  index.incoming.delete(fileId);
  index.allTags = [...index.tagIndex.keys()].sort();
  return index;
}

// --- queries ---------------------------------------------------------------

/** Get all backlinks (incoming edges) for a file. */
export function getBacklinks(index: LinkIndex, fileId: FileId): LinkEdge[] {
  return index.incoming.get(fileId) ?? [];
}

/** Get all outgoing links from a file. */
export function getOutgoingLinks(index: LinkIndex, fileId: FileId): LinkEdge[] {
  return index.outgoing.get(fileId) ?? [];
}

/** Get all files tagged with a given tag. */
export function getFilesByTag(index: LinkIndex, tag: string): FileId[] {
  return index.tagIndex.get(tag.toLowerCase()) ?? [];
}

/** Get the frontmatter property for a file. */
export function getFrontmatter(
  index: LinkIndex,
  fileId: FileId
): Record<string, unknown> | null {
  const meta = index.metadata.get(fileId);
  if (!meta || !meta.frontmatter?.valid) return null;
  return meta.frontmatter.data;
}

/** Count orphan notes (no incoming OR outgoing links). */
export function countOrphans(index: LinkIndex): number {
  let count = 0;
  for (const fileId of index.metadata.keys()) {
    const hasIncoming = (index.incoming.get(fileId)?.length ?? 0) > 0;
    const hasOutgoing = (index.outgoing.get(fileId)?.length ?? 0) > 0;
    if (!hasIncoming && !hasOutgoing) count++;
  }
  return count;
}

/** Type re-exports for consumers. */
export type { VaultNode };
