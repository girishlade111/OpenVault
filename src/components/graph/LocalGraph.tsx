"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useVaultStore, useActiveFileId } from "@/store/vault-store";
import { useIndexStore } from "@/store/index-store";
import {
  buildGraphLayout,
  stabilize,
  localSubgraph,
  tickLayout,
  type GraphLayout,
} from "@/lib/graph/layout";

const LOCAL_DEPTH = 2;

/**
 * Local graph mini-view for the right sidebar.
 *
 * Shows the active note + its neighbors up to N depth (BFS). The active note
 * is highlighted and centered. Clicking a neighbor opens it.
 *
 * The mini-canvas is a self-contained renderer (not using GraphCanvas, to keep
 * it lightweight for the sidebar). Physics runs continuously for a smooth feel.
 *
 * Supports:
 *  - Pan (drag background)
 *  - Zoom (scroll wheel)
 *  - Node hover + click
 */
export function LocalGraph() {
  const activeFileId = useActiveFileId();
  const manifest = useVaultStore((s) => s.manifest);
  const index = useIndexStore((s) => s.index);
  const openFile = useVaultStore((s) => s.openFile);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<GraphLayout | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const dragRef = useRef<{
    type: "pan" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({ type: null, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  // Build the local subgraph when the active file or index changes.
  const localData = useMemo(() => {
    if (!index || !activeFileId) return null;
    const sub = localSubgraph(index, activeFileId, LOCAL_DEPTH);
    // Build labels.
    const labels = new Map<string, string>();
    if (manifest) {
      for (const id of sub.nodeIds) {
        const node = manifest.nodes[id];
        if (node) labels.set(id, node.name.replace(/\.md$/i, ""));
      }
    }
    // Build a mini layout from the subgraph.
    const miniIndex = {
      ...index,
      // Filter to only the subgraph nodes.
      outgoing: new Map(
        [...index.outgoing].filter(([id]) => sub.nodeIds.has(id))
      ),
      incoming: new Map(
        [...index.incoming].filter(([id]) => sub.nodeIds.has(id))
      ),
      metadata: new Map(
        [...index.metadata].filter(([id]) => sub.nodeIds.has(id))
      ),
    };
    const layout = buildGraphLayout(miniIndex, labels, {}, true);
    // Center the active node at origin.
    const activeNode = layout.nodes.get(activeFileId);
    if (activeNode) {
      activeNode.x = 0;
      activeNode.y = 0;
      activeNode.pinned = true;
    }
    stabilize(layout, undefined, 150);
    return { layout, nodeIds: sub.nodeIds };
  }, [index, activeFileId, manifest]);

  // Keep layoutRef in sync and reset viewport when data changes.
  useEffect(() => {
    layoutRef.current = localData?.layout ?? null;
    viewportRef.current = { x: 0, y: 0, scale: 1 };
  }, [localData]);

  // Render function.
  const renderMini = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const layout = layoutRef.current;
    if (!canvas || !container || !layout) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const vp = viewportRef.current;
    ctx.save();
    ctx.translate(w / 2 + vp.x, h / 2 + vp.y);
    ctx.scale(vp.scale, vp.scale);

    // Edges.
    ctx.strokeStyle = "hsl(var(--muted-foreground) / 0.25)";
    ctx.lineWidth = 1 / vp.scale;
    for (const edge of layout.edges) {
      const a = layout.nodes.get(edge.source);
      const b = layout.nodes.get(edge.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Nodes.
    for (const node of layout.nodes.values()) {
      const r = 4 + Math.min(node.degree, 6) * 1.2;
      const isActive = node.id === activeFileId;
      const isHovered = node.id === hoveredId;

      // Glow effect
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "rgba(245, 158, 11, 0.2)" : "hsla(var(--primary) / 0.12)";
      ctx.fill();

      if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 158, 11, 0.3)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#f59e0b" : isHovered ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.7)";
      ctx.fill();

      if (isHovered || isActive) {
        const fontSize = Math.max(8, Math.min(11, 10 * vp.scale)) / vp.scale;
        ctx.fillStyle = "hsl(var(--foreground))";
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, node.x, node.y + r + 3);
      }
    }

    ctx.restore();
  }, [activeFileId, hoveredId]);

  // Animation loop.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const layout = layoutRef.current;
      if (layout) {
        tickLayout(layout);
        renderMini();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      running = false;
    };
  }, [localData, renderMini]);

  // Non-passive wheel handler for zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const vp = viewportRef.current;
      const newScale = Math.max(0.3, Math.min(4, vp.scale * (1 + delta)));
      // Zoom toward cursor.
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const wx = (cx - vp.x) / vp.scale;
      const wy = (cy - vp.y) / vp.scale;
      vp.scale = newScale;
      vp.x = cx - wx * newScale;
      vp.y = cy - wy * newScale;
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  // Mouse handlers for pan and interaction.
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !layoutRef.current) return;

    // Check if hovering a node - if so, don't start pan
    if (hoveredId) return;

    dragRef.current = {
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current.type === "pan") {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      viewportRef.current.x += dx;
      viewportRef.current.y += dy;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      return;
    }

    // Hover detection
    const canvas = canvasRef.current;
    if (!canvas || !layoutRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const vp = viewportRef.current;
    const wx = (e.clientX - rect.left - rect.width / 2 - vp.x) / vp.scale;
    const wy = (e.clientY - rect.top - rect.height / 2 - vp.y) / vp.scale;
    let hit: string | null = null;
    const layout = layoutRef.current;
    for (const node of layout.nodes.values()) {
      const r = 4 + Math.min(node.degree, 6) * 1.2;
      const dx = wx - node.x;
      const dy = wy - node.y;
      if (dx * dx + dy * dy <= (r + 2) * (r + 2)) {
        hit = node.id;
        break;
      }
    }
    setHoveredId(hit);
    if (canvas) canvas.style.cursor = hit ? "pointer" : "grab";
  };

  const handleMouseUp = () => {
    dragRef.current = { type: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
  };

  const handleClick = () => {
    if (hoveredId && hoveredId !== activeFileId) {
      openFile(hoveredId);
    }
  };

  if (!activeFileId || !localData) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Open a note to see its local graph.
      </p>
    );
  }

  const neighborCount = localData.nodeIds.size - 1;

  return (
    <div>
      <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground border-b">
        <span>{neighborCount} neighbor{neighborCount !== 1 ? "s" : ""}</span>
        <span>· depth {LOCAL_DEPTH}</span>
        <span className="ml-auto">Drag to pan · Scroll to zoom</span>
      </div>
      <div ref={containerRef} className="h-48 w-full relative">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-grab"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={(e) => {
            handleMouseUp();
            setHoveredId(null);
            const canvas = e.currentTarget;
            canvas.style.cursor = "grab";
          }}
          onClick={handleClick}
        />
      </div>
    </div>
  );
}

/** Header for the local graph section. */
export function LocalGraphHeader() {
  return (
    <div className="px-3 py-2 border-b flex items-center gap-2 text-xs font-medium">
      <Sparkles className="w-3.5 h-3.5" />
      Local graph
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" />
    </svg>
  );
}
