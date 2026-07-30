/**
 * In-memory demo vault fallback.
 *
 * Used when the File System Access API is unavailable (Safari/Firefox, or a
 * sandboxed iframe without `allow-downloads` / the directory-picker permission
 * policy). The vault is seeded with a few interconnected markdown notes so the
 * user can immediately explore the three-pane layout, file tree, and (in later
 * phases) the link index and graph view.
 *
 * The demo vault is fully in-memory: edits are NOT persisted to disk. This is
 * clearly communicated in the status bar. It exists purely so the app is
 * never a dead screen.
 */

import type { VaultManifest, VaultNode } from "./types";
import { makeFileId } from "./id";

interface SeedFile {
  path: string;
  content: string;
}

const SEED: SeedFile[] = [
  {
    path: "Welcome.md",
    content: `# Welcome to your Vault

This is a **local-first**, plain-text knowledge base. Every note is a real
\`.md\` file on disk — there is no proprietary database.

Try these next:

- Open the [[Daily/2024-01-01|Daily Note]] for today
- Browse the [[Concepts/Zettelkasten]] method
- See the [[Concepts/MOC|Map of Content]]

#welcome #getting-started
`,
  },
  {
    path: "Concepts/Zettelkasten.md",
    content: `---
title: Zettelkasten
aliases: [slip-box]
tags: [concept, methodology]
---

# Zettelkasten

A note-taking method developed by Niklas Luhmann. Core ideas:

1. **Atomic notes** — one idea per note.
2. **Link freely** — connect related notes with [[WikiLinks]].
3. **Emergent structure** — let the graph grow organically.

See also [[Concepts/MOC]] for the index pattern.

#concept #methodology
`,
  },
  {
    path: "Concepts/MOC.md",
    content: `---
title: Map of Content
aliases: [MOC, index-note]
tags: [concept, structure]
---

# Map of Content

A hub note that links to related notes on a theme.

- [[Concepts/Zettelkasten]] — the methodology
- [[Welcome]] — start here
- [[Projects/Website Redesign]] — active project

#concept #structure
`,
  },
  {
    path: "Projects/Website Redesign.md",
    content: `---
title: Website Redesign
status: in-progress
due: 2024-03-15
tags: [project, web]
---

# Website Redesign

Active project for Q1.

## Tasks
- [x] Audit current site
- [ ] Draft new information architecture
- [ ] Review with [[People/Alice]]

Linked from [[Concepts/MOC]].
`,
  },
  {
    path: "Projects/Untitled Project.md",
    content: `# Untitled Project

A draft with no links yet — it mentions Alice but doesn't link to her.

Reference: talk to Alice about scope.
`,
  },
  {
    path: "People/Alice.md",
    content: `---
title: Alice
role: Designer
tags: [person]
---

# Alice

Designer on the [[Projects/Website Redesign]] team.
`,
  },
  {
    path: "Daily/2024-01-01.md",
    content: `# 2024-01-01

New year, new vault. Today:

- Set up the knowledge base
- Read about [[Concepts/Zettelkasten]]
- Coffee with [[People/Alice]]

#daily
`,
  },
  {
    path: "Concepts/Markdown Syntax Guide.md",
    content: `---
title: Markdown Syntax Guide
tags: [reference, markdown]
---

# Markdown Syntax Guide

A showcase of every supported syntax. See also [[Concepts/Zettelkasten]].

## WikiLinks & Embeds

Link to a note: [[Concepts/MOC]]. With an alias: [[Concepts/MOC|the index]].
Link to a heading: [[Welcome#Welcome to your Vault]].
Embed a note: ![[Concepts/Zettelkasten]].

## Tags

Inline tags: #reference #markdown/syntax #concept/advanced

## Callouts

> [!note] Note title
> This is a note callout. Use it for general information.

> [!warning] Warning title
> Be careful with this!

> [!tip]+ Foldable (open by default)
> Click the caret to collapse this tip.

> [!danger]- Foldable (collapsed by default)
> Hidden until you expand it.

## Footnotes

Here's a statement with a footnote[^1]. And another[^second].

[^1]: This is the first footnote definition.
[^second]: This is the second one, with a named id.

## Math (coming with KaTeX)

Inline math: $E = mc^2$. Block math:

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Standard Markdown

**Bold**, *italic*, \`inline code\`, [regular link](https://example.com).

> Regular blockquote.

\`\`\`javascript
// Fenced code with syntax highlighting
function hello(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`
`,
  },
];

/** Build a complete VaultManifest from the seed files (no folder files on disk). */
export function buildDemoManifest(): VaultManifest {
  const nodes: Record<string, VaultNode> = {};
  const pathIndex: Record<string, string> = {};
  const counts = { files: 0, folders: 0, markdown: 0, images: 0, canvases: 0 };

  // Root
  const rootId = makeFileId("");
  nodes[rootId] = {
    id: rootId,
    name: "Demo Vault",
    path: "",
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
  pathIndex[""] = rootId;
  counts.folders = 1;

  // Ensure every intermediate folder exists.
  const ensureFolder = (relPath: string): VaultNode => {
    if (relPath === "") return nodes[rootId];
    const existing = pathIndex[relPath];
    if (existing) return nodes[existing];
    const parts = relPath.split("/");
    const name = parts.pop()!;
    const parentPath = parts.join("/");
    const parent = ensureFolder(parentPath);
    const id = makeFileId(relPath);
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
    parent.childIds.push(id);
    return node;
  };

  for (const seed of SEED) {
    const parts = seed.path.split("/");
    const name = parts.pop()!;
    const folderPath = parts.join("");
    ensureFolder(folderPath);
    const parent = ensureFolder(folderPath);
    const id = makeFileId(seed.path);
    const ext = name.split(".").pop()?.toLowerCase() ?? null;
    const node: VaultNode = {
      id,
      name,
      path: seed.path,
      kind: "file",
      parentId: parent.id,
      childIds: [],
      extension: ext ?? null,
      size: seed.content.length,
      mtime: Date.now(),
      isMarkdown: ext === "md" || ext === "markdown",
      isImage: false,
      isCanvas: ext === "canvas",
    };
    nodes[id] = node;
    pathIndex[seed.path] = id;
    counts.files++;
    if (node.isMarkdown) counts.markdown++;
    parent.childIds.push(id);
  }

  // Sort children of every folder: folders first, then files, alpha.
  for (const node of Object.values(nodes)) {
    if (node.kind !== "folder") continue;
    node.childIds.sort((a, b) => {
      const A = nodes[a];
      const B = nodes[b];
      if (A.kind !== B.kind) return A.kind === "folder" ? -1 : 1;
      return A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
    });
  }

  return {
    rootId,
    nodes,
    pathIndex,
    counts,
    scannedAt: Date.now(),
  };
}

/** In-memory content store for the demo vault. */
export function buildDemoContent(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seed of SEED) out[seed.path] = seed.content;
  return out;
}
