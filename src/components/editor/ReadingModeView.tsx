"use client";

import { useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useVaultStore } from "@/store/vault-store";

/**
 * Rendered markdown view for Reading Mode. Shows the document as fully styled
 * HTML (not editable). Renders headings, bold/italic, links, images, code
 * blocks, callouts, and task list checkboxes.
 *
 * Uses react-markdown (already a dependency) with custom components.
 */
export function ReadingModeView({
  text,
  fileId,
}: {
  text: string;
  fileId: string;
}) {
  const openFile = useVaultStore((s) => s.openFile);
  const manifest = useVaultStore((s) => s.manifest);

  // Resolve wikilinks in text: convert [[Note]] to markdown links for rendering
  const processedText = useMemo(() => {
    return text
      // Convert ![[image.ext]] to markdown images
      .replace(/!\[\[([^\]\n]+)\]\]/g, (_match, target: string) => {
        const ext = target.split(".").pop()?.toLowerCase() ?? "";
        const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
        if (imageExts.includes(ext)) {
          return `![${target}](vault://${target})`;
        }
        return `> *Embedded: ${target}*`;
      })
      // Convert [[Note|Alias]] and [[Note]] to links
      .replace(/\[\[([^\]\n]+)\]\]/g, (_match, inner: string) => {
        const pipeIdx = inner.indexOf("|");
        const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
        const alias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : target;
        return `[${alias}](wikilink://${encodeURIComponent(target)})`;
      });
  }, [text]);

  const handleLinkClick = useCallback(
    (href: string) => {
      if (!href.startsWith("wikilink://")) return;
      const target = decodeURIComponent(href.replace("wikilink://", ""));
      if (!manifest) return;
      // Find the file matching this note name
      const nodes = Object.values(manifest.nodes);
      const match = nodes.find(
        (n) =>
          n.kind === "file" &&
          (n.name === target ||
            n.name === `${target}.md` ||
            n.name.replace(/\.md$/, "") === target)
      );
      if (match) {
        openFile(match.id);
      }
    },
    [manifest, openFile]
  );

  const components: Components = useMemo(
    () => ({
      h1: ({ children }) => (
        <h1 className="text-3xl font-bold mt-8 mb-4 text-foreground">{children}</h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-2xl font-semibold mt-6 mb-3 text-foreground border-b border-border pb-2">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-xl font-semibold mt-5 mb-2 text-foreground">{children}</h3>
      ),
      h4: ({ children }) => (
        <h4 className="text-lg font-medium mt-4 mb-2 text-foreground">{children}</h4>
      ),
      h5: ({ children }) => (
        <h5 className="text-base font-medium mt-3 mb-1 text-foreground">{children}</h5>
      ),
      h6: ({ children }) => (
        <h6 className="text-sm font-medium mt-3 mb-1 text-muted-foreground">{children}</h6>
      ),
      p: ({ children }) => (
        <p className="my-3 leading-7 text-foreground/90">{children}</p>
      ),
      a: ({ href, children }) => {
        const isWikilink = href?.startsWith("wikilink://");
        return (
          <a
            href={isWikilink ? undefined : href}
            onClick={(e) => {
              if (isWikilink && href) {
                e.preventDefault();
                handleLinkClick(href);
              }
            }}
            className="text-primary underline decoration-primary/40 hover:decoration-primary cursor-pointer transition-colors"
            target={isWikilink ? undefined : "_blank"}
            rel={isWikilink ? undefined : "noopener noreferrer"}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        if (src?.startsWith("vault://")) {
          // Local vault image placeholder
          return (
            <span className="inline-flex items-center gap-2 px-4 py-2 my-2 rounded-md bg-muted text-muted-foreground text-sm">
              Image: {alt || src.replace("vault://", "")}
            </span>
          );
        }
        return (
          <img
            src={src}
            alt={alt || ""}
            className="max-w-full max-h-96 rounded-md border border-border my-4"
            loading="lazy"
          />
        );
      },
      blockquote: ({ children }) => {
        return (
          <blockquote className="border-l-4 border-primary/40 bg-primary/5 pl-4 py-2 my-4 italic text-muted-foreground rounded-r-md">
            {children}
          </blockquote>
        );
      },
      code: ({ children, className }) => {
        const isBlock = className?.includes("language-");
        if (isBlock) {
          return (
            <code className="block bg-muted rounded-lg p-4 my-4 text-sm font-mono overflow-x-auto text-foreground/90">
              {children}
            </code>
          );
        }
        return (
          <code className="px-1.5 py-0.5 bg-muted rounded text-sm font-mono text-foreground/90">
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="bg-muted rounded-lg p-4 my-4 overflow-x-auto text-sm">
          {children}
        </pre>
      ),
      ul: ({ children }) => (
        <ul className="list-disc pl-6 my-3 space-y-1">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="list-decimal pl-6 my-3 space-y-1">{children}</ol>
      ),
      li: ({ children }) => {
        // Detect task list items
        const childArr = Array.isArray(children) ? children : [children];
        const firstChild = childArr[0];
        if (typeof firstChild === "string") {
          const taskMatch = firstChild.match(/^\[([ xX])\]\s*/);
          if (taskMatch) {
            const checked = taskMatch[1] !== " ";
            const rest = firstChild.slice(taskMatch[0].length);
            return (
              <li className="list-none -ml-6 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mt-1.5 accent-[var(--primary)]"
                />
                <span className={checked ? "line-through text-muted-foreground" : ""}>
                  {rest}
                  {childArr.slice(1)}
                </span>
              </li>
            );
          }
        }
        return <li className="leading-7">{children}</li>;
      },
      hr: () => <hr className="my-8 border-border" />,
      table: ({ children }) => (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse border border-border text-sm">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-muted">{children}</thead>
      ),
      th: ({ children }) => (
        <th className="border border-border px-3 py-2 text-left font-medium">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-border px-3 py-2">{children}</td>
      ),
      strong: ({ children }) => (
        <strong className="font-bold text-foreground">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,
    }),
    [handleLinkClick]
  );

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[760px] mx-auto px-6 py-4 reading-mode-content">
        <ReactMarkdown components={components}>
          {processedText}
        </ReactMarkdown>
      </div>
    </div>
  );
}
