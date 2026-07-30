"use client";

import { type ReactNode, useCallback } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { BranchNode, LeafNode, WorkspaceNode } from "@/lib/workspace/types";
import { useVaultStore } from "@/store/vault-store";
import { EditorLeaf } from "./EditorLeaf";

/**
 * Recursively render the workspace tree.
 *
 *  - Leaf  → <EditorLeaf>
 *  - Branch → <ResizablePanelGroup> with one <ResizablePanel> per child,
 *    each wrapping a nested <WorkspaceRenderer>. Sizes are persisted back to
 *    the store via the group's onLayout callback.
 *
 * Each branch's PanelGroup is keyed by its id so React remounts it cleanly
 * when its children set changes (a split or close). Leaves are keyed by id so
 * their tab/content state survives sibling structural changes.
 */
export function WorkspaceRenderer({ node }: { node: WorkspaceNode }) {
  if (node.type === "leaf") {
    return <EditorLeaf leaf={node} />;
  }
  return <BranchView branch={node} />;
}

function BranchView({ branch }: { branch: BranchNode }) {
  const setLeafSizes = useVaultStore((s) => s.setLeafSizes);

  const handleLayout = useCallback(
    (sizes: number[]) => {
      setLeafSizes(branch.id, sizes);
    },
    [branch.id, setLeafSizes]
  );

  // Build a FLAT array of Panel + Handle elements as direct children of
  // PanelGroup. react-resizable-panels requires Panel/PanelResizeHandle to be
  // direct children (it reads them via React.Children to register each one);
  // wrapping in a <div> or <Fragment> breaks that registration.
  const items: ReactNode[] = [];
  branch.children.forEach((child, i) => {
    items.push(
      <ResizablePanel
        key={child.id}
        id={child.id}
        order={i + 1}
        defaultSize={branch.sizes[i] ?? 100 / branch.children.length}
        minSize={12}
      >
        <WorkspaceRenderer node={child} />
      </ResizablePanel>
    );
    if (i < branch.children.length - 1) {
      items.push(<ResizableHandle key={`h-${child.id}`} />);
    }
  });

  return (
    <ResizablePanelGroup
      key={branch.id}
      direction={branch.direction}
      onLayout={handleLayout}
      className="h-full w-full"
    >
      {items}
    </ResizablePanelGroup>
  );
}

/** Type-only re-export for callers that build leaves. */
export type { LeafNode };
