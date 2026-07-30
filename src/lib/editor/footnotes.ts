/**
 * Footnote extraction (two-pass).
 *
 * Markdown footnotes:
 *   - Reference:  [^1]   inline in the body
 *   - Definition: [^1]: actual footnote text   at the end of the document
 *
 * Pass 1: collect all `[^id]` references and assign them stable DOM ids.
 * Pass 2: collect all `[^id]: text` definitions and bind them to references.
 *
 * The editor renders references as superscript links; hovering one shows a
 * popover with the definition text (wired in the React layer).
 */

export interface FootnoteRef {
  from: number;
  to: number;
  id: string;
  /** Sequential display number (1-based), assigned in order of appearance. */
  number: number;
  /** The matching definition, if found in pass 2. */
  definition: FootnoteDef | null;
}

export interface FootnoteDef {
  from: number;
  to: number;
  id: string;
  /** The definition text (after the `:`). */
  text: string;
  /** 0-based line number. */
  line: number;
}

const REF_RE = /\[\^([\w-]+)\](?!:)/g; // [^id] not followed by `:`
const DEF_RE = /^\[\^([\w-]+)\]:\s*(.*)$/;

export interface ParsedFootnotes {
  refs: FootnoteRef[];
  defs: FootnoteDef[];
}

/** Two-pass footnote extraction. */
export function extractFootnotes(text: string): ParsedFootnotes {
  // Pass 1: references.
  const refs: FootnoteRef[] = [];
  const seenIds = new Map<string, number>(); // id → display number
  for (const match of text.matchAll(REF_RE)) {
    const id = match[1];
    if (!seenIds.has(id)) {
      seenIds.set(id, seenIds.size + 1);
    }
    refs.push({
      from: match.index!,
      to: match.index! + match[0].length,
      id,
      number: seenIds.get(id)!,
      definition: null,
    });
  }

  // Pass 2: definitions.
  const defs: FootnoteDef[] = [];
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = DEF_RE.exec(line);
    if (m) {
      const id = m[1];
      const defText = m[2];
      defs.push({
        from: offset,
        to: offset + line.length,
        id,
        text: defText,
        line: i,
      });
    }
    offset += line.length + 1; // +1 for newline
  }

  // Bind definitions to references.
  const defById = new Map(defs.map((d) => [d.id, d]));
  for (const ref of refs) {
    ref.definition = defById.get(ref.id) ?? null;
  }

  return { refs, defs };
}
