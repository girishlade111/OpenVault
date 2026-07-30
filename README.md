# Open Vault

A powerful, local-first desktop application designed for managing your markdown notes and knowledge base. It features a rich markdown editor, an interactive canvas view, a knowledge graph, and a robust file tree structure.

## 🚀 Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Desktop Runtime**: [Electron](https://www.electronjs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) & [Shadcn UI](https://ui.shadcn.com/)
- **Database**: [Prisma ORM](https://www.prisma.io/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Editor**: [CodeMirror](https://codemirror.net/) (with Markdown support) & [MDXEditor](https://mdxeditor.dev/)
- **Package Manager**: [Bun](https://bun.sh/)

## 🌟 Key Features

- **Rich Markdown Editing**: A highly capable markdown editor tailored for note-taking.
- **File Explorer**: Intuitive file tree (`FileTree.tsx`) for managing and navigating your vault's structure.
- **Knowledge Graph**: Visualize connections and relationships between your notes using the interactive graph view (`GraphView.tsx`).
- **Canvas View**: A spatial canvas (`CanvasView.tsx`) for brainstorming and organizing ideas visually.
- **Local First**: Built as a secure, offline-capable Electron desktop app, ensuring your data stays on your machine.

## 🛠️ Getting Started

### Prerequisites

Ensure you have [Bun](https://bun.sh/) installed on your system.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/girishlade111/OpenVault.git
   cd OpenVault
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

### Development Scripts

Run the web version of the application:
```bash
bun run dev
```

Run the desktop application concurrently with the Next.js development server:
```bash
bun run dev:desktop
```

### Build & Release

To build the desktop application executable:
```bash
bun run build:desktop
```

To build and publish the release directly to GitHub:
```bash
bun run release:desktop
```

## 📂 Architecture & Project Structure

- `src/components/vault/`: Contains the core vault components such as the main `VaultApp` and the `FileTree`.
- `src/components/workspace/`: Handles the editor layout and workspace management (e.g., `EditorLeaf`).
- `src/components/canvas/`: Infinite canvas components for visual note organization.
- `src/components/graph/`: Interactive knowledge graph visualization.
- `prisma/`: Contains your database schema and migrations.
- `main.js`: The primary entry point for the Electron process.
