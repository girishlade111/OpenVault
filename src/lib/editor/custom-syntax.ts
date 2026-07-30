/**
 * Custom Obsidian-flavored Markdown syntax extractors.
 *
 * These are PURE functions over the document text. They extract the custom
 * syntax Obsidian adds on top of standard Markdown:
 *
 *  - WikiLinks:       [[Note Name]] or [[Note Name|Alias]] or [[Note#Heading]]
 *  - Block refs:      [[Note#^blockid]]
 *  - Embeds:          ![[image.png]] or ![[Note Name]] (transclusion)
 *  - Tags:            #tag or #parent/child/nested
 *  - Frontmatter:     leading --- YAML block
 *
 * The editor's live-preview decorations consume these to style the syntax.
 * Sprint 5's bidirectional link indexer will reuse them to build the graph.
 *
 * All ranges are CHARACTER offsets into the document string (0-based,
 * half-open [from, to)) so they map directly to CodeMirror positions.
 */

/** A WikiLink reference: [[target]], [[target|alias]], [[target#heading]], [[target#^block]]. */
export interface WikiLinkRef {
  from: number;
  to: number;
  /** The raw link target, e.g. "Note Name", "Note Name#heading", "Note#^block". */
  target: string;
  /** Optional alias (the part after `|`). */
  alias: string | null;
  /** Note name portion (before any `#`). */
  noteName: string;
  /** Heading anchor (after `#`, before `^`), or null. */
  heading: string | null;
  /** Block reference id (after `^`), or null. */
  blockId: string | null;
  /** True if this is an embed (prefixed with `!`). */
  embed: boolean;
}

/** An embed: ![[target]] — renders the target (image or note transclusion) inline. */
export interface EmbedRef {
  from: number;
  to: number;
  target: string;
  /** True if the target looks like an image file. */
  isImage: boolean;
  /** True if the target is a note transclusion (not a file). */
  isNote: boolean;
}

/** A tag: #tag or #parent/child/nested. */
export interface TagRef {
  from: number;
  to: number;
  /** The full tag path, e.g. "parent/child". */
  tag: string;
}

/** Parsed YAML frontmatter. */
export interface Frontmatter {
  /** Character offset where the frontmatter starts (the opening `---`). */
  from: number;
  /** Character offset where it ends (after the closing `---`). */
  to: number;
  /** The raw YAML text between the fences (exclusive of the fences). */
  raw: string;
  /** Parsed key→value pairs (values are strings, numbers, booleans, or arrays). */
  data: Record<string, unknown>;
  /** True if parsing succeeded. */
  valid: boolean;
}

// --- WikiLink + embed extraction -------------------------------------------

// Matches [[...]] with optional `!` prefix (embed) and optional `|alias`.
// Allows spaces, but not newlines or unmatched brackets inside.
const WIKILINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

export function extractWikiLinks(text: string): WikiLinkRef[] {
  const refs: WikiLinkRef[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    const embed = match[1] === "!";
    const inner = match[2].trim();
    const from = match.index!;
    const to = from + match[0].length;
    const pipeIdx = inner.indexOf("|");
    let target: string;
    let alias: string | null;
    if (pipeIdx >= 0) {
      target = inner.slice(0, pipeIdx).trim();
      alias = inner.slice(pipeIdx + 1).trim() || null;
    } else {
      target = inner;
      alias = null;
    }
    // Split target into noteName # heading ^ blockId
    let noteName = target;
    let heading: string | null = null;
    let blockId: string | null = null;
    const hashIdx = target.indexOf("#");
    if (hashIdx >= 0) {
      noteName = target.slice(0, hashIdx).trim();
      const anchor = target.slice(hashIdx + 1);
      const caretIdx = anchor.indexOf("^");
      if (caretIdx >= 0) {
        heading = anchor.slice(0, caretIdx).trim() || null;
        blockId = anchor.slice(caretIdx + 1).trim() || null;
      } else {
        heading = anchor.trim() || null;
      }
    }
    refs.push({ from, to, target, alias, noteName, heading, blockId, embed });
  }
  return refs;
}

// --- Embed extraction (subset of WikiLinks with `!` prefix) ----------------

export function extractEmbeds(text: string): EmbedRef[] {
  const links = extractWikiLinks(text);
  return links
    .filter((l) => l.embed)
    .map((l) => {
      const target = l.target;
      const ext = target.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
      const isImage = imageExts.includes(ext);
      return {
        from: l.from,
        to: l.to,
        target,
        isImage,
        isNote: !isImage && ext === "" || !imageExts.includes(ext),
      };
    });
}

// --- Tag extraction --------------------------------------------------------

// A tag starts with # followed by a non-space, non-digit char, then
// alphanumerics, underscores, hyphens, and slashes (for nested tags).
// Must not be preceded by a word char (to avoid matching # in hex colors etc).
const TAG_RE = /(^|[\s(])#([a-zA-Z][\w/-]*)/g;

export function extractTags(text: string): TagRef[] {
  const tags: TagRef[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    const prefix = match[1];
    const tag = match[2];
    const from = match.index! + prefix.length;
    tags.push({ from, to: from + 1 + tag.length, tag });
  }
  return tags;
}

// --- Frontmatter extraction ------------------------------------------------

/** Detect + parse leading YAML frontmatter. Returns null if none. */
export function extractFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---")) return null;
  // Find the closing --- on its own line.
  const afterOpen = text.slice(3);
  const newlineAfterOpen = afterOpen.match(/^.*?\n/);
  if (!newlineAfterOpen) return null;
  const bodyStart = 3 + newlineAfterOpen[0].length;
  // Search for a line that is exactly --- or ...
  const rest = text.slice(bodyStart);
  const closeMatch = rest.match(/^---\s*$|^...\s*$/m);
  if (!closeMatch) return null;
  const closeIdx = rest.indexOf(closeMatch[0]);
  const raw = rest.slice(0, closeIdx);
  const closeEnd = closeIdx + closeMatch[0].length;
  const from = 0;
  const to = bodyStart + closeEnd;
  // Parse the YAML (minimal parser — no external dep).
  const { data, valid } = parseSimpleYaml(raw);
  return { from, to, raw, data, valid };
}

/**
 * Minimal YAML parser supporting:
 *  - key: value
 *  - key: "quoted string"
 *  - key: [item, item]   (inline arrays)
 *  - key:
 *      - item
 *      - item            (block arrays)
 *  - Booleans: true/false
 *  - Numbers
 *
 * Not a full YAML implementation — sufficient for frontmatter, which is
 * what Obsidian uses. Throws are caught; invalid → valid: false.
 */
export function parseSimpleYaml(raw: string): {
  data: Record<string, unknown>;
  valid: boolean;
} {
  const data: Record<string, unknown> = {};
  try {
    const lines = raw.split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Skip blank/comment lines.
      if (line.trim() === "" || line.trim().startsWith("#")) {
        i++;
        continue;
      }
      const m = /^(\s*)([\w-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) {
        i++;
        continue;
      }
      const indent = m[1];
      const key = m[2];
      let value = m[3].trim();
      if (indent !== "") {
        // Unexpected indented key without a parent — skip.
        i++;
        continue;
      }
      if (value === "") {
        // Block array? Check following lines.
        const items: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const itemLine = lines[j];
          const im = /^(\s+)-\s+(.*)$/.exec(itemLine);
          if (!im) break;
          items.push(parseScalar(im[2].trim()) as string);
          j++;
        }
        if (items.length > 0) {
          data[key] = items;
          i = j;
          continue;
        }
        data[key] = null;
        i++;
        continue;
      }
      // Inline value.
      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1);
        data[key] = inner
          .split(",")
          .map((s) => parseScalar(s.trim()))
          .filter((s) => s !== "");
      } else {
        data[key] = parseScalar(value);
      }
      i++;
    }
    return { data, valid: true };
  } catch {
    return { data, valid: false };
  }
}

function parseScalar(s: string): unknown {
  if (s === "") return "";
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** Serialize a frontmatter data object back to YAML text (with --- fences). */
export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      lines.push(`${key}:`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatScalar(item)}`);
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  // Quote if it contains special chars or looks like a number/bool.
  if (/[:\[\]{}#&*!|>'"%@`]/.test(s) || /^(-?\d)|^(true|false|null)/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

// --- convenience: extract everything in one pass ---------------------------

export interface ParsedCustomSyntax {
  wikiLinks: WikiLinkRef[];
  embeds: EmbedRef[];
  tags: TagRef[];
  frontmatter: Frontmatter | null;
}

export function parseCustomSyntax(text: string): ParsedCustomSyntax {
  const wikiLinks = extractWikiLinks(text);
  const embeds = wikiLinks.filter((l) => l.embed).map(toEmbed);
  const tags = extractTags(text);
  const frontmatter = extractFrontmatter(text);
  return { wikiLinks, embeds, tags, frontmatter };
}

function toEmbed(l: WikiLinkRef): EmbedRef {
  const ext = l.target.split(".").pop()?.toLowerCase() ?? "";
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
  return {
    from: l.from,
    to: l.to,
    target: l.target,
    isImage: imageExts.includes(ext),
    isNote: !imageExts.includes(ext),
  };
}
