"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { FileId } from "@/lib/vault/types";
import type { GraphLayout, LayoutOptions } from "@/lib/graph/layout";
import { tickLayout, pinNode, unpinNode } from "@/lib/graph/layout";

interface GraphCanvasProps {
  layout: GraphLayout;
  options?: LayoutOptions;
  /** Active file id (highlighted). */
  activeFileId?: FileId | null;
  /** Set of file ids to highlight (e.g. filter results). */
  highlightedIds?: Set<FileId> | null;
  /** Called when a node is clicked. */
  onNodeClick?: (fileId: FileId) => void;
  /** Whether to run the simulation continuously. */
  simulate?: boolean;
  /** Node color (CSS color string). */
  nodeColor?: string;
  /** Per-node colors (overrides default nodeColor). */
  nodeColors?: Map<FileId, string>;
  /** Active node color. */
  activeColor?: string;
  /** Edge color. */
  edgeColor?: string;
  /** Background color. */
  backgroundColor?: string;
  /** Whether to show labels on all nodes (vs hover-only). */
  showAllLabels?: boolean;
}

/**
 * Canvas-based force-directed graph renderer.
 *
 * Features:
 *  - Continuous physics simulation (toggleable).
 *  - Pan (drag background) + zoom (wheel).
 *  - Node hover → label shown.
 *  - Node click → onNodeClick callback.
 *  - Node drag → pin at cursor position (unpins on release).
 *  - Active node highlighted with a ring.
 *  - Node size scales with degree.
 *
 * The canvas is HiDPI-aware (scales by devicePixelRatio).
 */
export function GraphCanvas({
  layout,
  options,
  activeFileId,
  highlightedIds,
  onNodeClick,
  simulate = true,
  nodeColor = "hsl(var(--primary))",
  nodeColors,
  activeColor = "#f59e0b",
  edgeColor = "hsl(var(--muted-foreground) / 0.3)",
  backgroundColor = "transparent",
  showAllLabels = false,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);

  // Viewport state: pan offset + zoom scale.
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<FileId | null>(null);
  const dragRef = useRef<{
    type: "pan" | "node" | null;
    nodeId: FileId | null;
    lastX: number;
    lastY: number;
  }>({ type: null, nodeId: null, lastX: 0, lastY: 0 });

  // Convert screen coords → world coords.
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const vp = viewportRef.current;
    return {
      x: (sx - rect.left - rect.width / 2 - vp.x) / vp.scale,
      y: (sy - rect.top - rect.height / 2 - vp.y) / vp.scale,
    };
  }, []);

  // Find the node at screen coords (hit test).
  const nodeAt = useCallback(
    (sx: number, sy: number): FileId | null => {
      const world = screenToWorld(sx, sy);
      // Iterate in reverse so top-drawn nodes are hit first.
      const nodeArr = [...layout.nodes.values()];
      for (let i = nodeArr.length - 1; i >= 0; i--) {
        const n = nodeArr[i];
        const r = nodeRadius(n.degree);
        const dx = world.x - n.x;
        const dy = world.y - n.y;
        if (dx * dx + dy * dy <= r * r) return n.id;
      }
      return null;
    },
    [layout, screenToWorld]
  );

  // Render one frame.
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
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

    // Clear.
    ctx.clearRect(0, 0, w, h);
    if (backgroundColor !== "transparent") {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, w, h);
    }

    const vp = viewportRef.current;
    ctx.save();
    ctx.translate(w / 2 + vp.x, h / 2 + vp.y);
    ctx.scale(vp.scale, vp.scale);

    // Draw edges.
    ctx.strokeStyle = edgeColor;
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

    // Draw nodes.
    for (const node of layout.nodes.values()) {
      const r = nodeRadius(node.degree);
      const isActive = node.id === activeFileId;
      const isHovered = node.id === hoveredId;
      const isHighlighted = highlightedIds?.has(node.id);

      // Active ring.
      if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = activeColor + "40";
        ctx.fill();
      }

      // Node circle.
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      const c = nodeColors?.get(node.id) || nodeColor;
      if (isActive) {
        ctx.fillStyle = activeColor;
      } else if (isHovered) {
        ctx.fillStyle = c;
        ctx.globalAlpha = 1;
      } else if (highlightedIds && !isHighlighted) {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.2;
      } else {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.8;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label: show on hover, for active, or if showAllLabels.
      if (isHovered || isActive || showAllLabels) {
        ctx.fillStyle = "hsl(var(--foreground))";
        ctx.font = `${12 / vp.scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, node.x, node.y + r + 4);
      }
    }

    ctx.restore();
  }, [layout, activeFileId, hoveredId, highlightedIds, nodeColor, nodeColors, activeColor, edgeColor, backgroundColor, showAllLabels]);

  // Animation loop: tick simulation + render.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      if (simulate) {
        tickLayout(layout, options);
      }
      render();
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [simulate, layout, options, render]);

  // Mouse handlers.
  const handleMouseDown = (e: React.MouseEvent) => {
    const id = nodeAt(e.clientX, e.clientY);
    if (id) {
      dragRef.current = { type: "node", nodeId: id, lastX: e.clientX, lastY: e.clientY };
      pinNode(layout, id, ...Object.values(screenToWorld(e.clientX, e.clientY)) as [number, number]);
    } else {
      dragRef.current = { type: "pan", nodeId: null, lastX: e.clientX, lastY: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current.type === "pan") {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      viewportRef.current.x += dx;
      viewportRef.current.y += dy;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else if (dragRef.current.type === "node" && dragRef.current.nodeId) {
      const world = screenToWorld(e.clientX, e.clientY);
      pinNode(layout, dragRef.current.nodeId, world.x, world.y);
    } else {
      // Hover detection.
      const id = nodeAt(e.clientX, e.clientY);
      setHoveredId(id);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = id ? "pointer" : "grab";
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragRef.current.type === "node" && dragRef.current.nodeId) {
      // If barely moved, treat as click.
      const moved = Math.abs(e.clientX - dragRef.current.lastX) + Math.abs(e.clientY - dragRef.current.lastY);
      if (moved < 4 && onNodeClick) {
        onNodeClick(dragRef.current.nodeId);
      }
      unpinNode(layout, dragRef.current.nodeId);
    }
    dragRef.current = { type: null, nodeId: null, lastX: 0, lastY: 0 };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.1, Math.min(5, viewportRef.current.scale * (1 + delta)));
    // Zoom toward cursor.
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const vp = viewportRef.current;
      // World point under cursor before zoom.
      const wx = (cx - vp.x) / vp.scale;
      const wy = (cy - vp.y) / vp.scale;
      vp.scale = newScale;
      // Adjust pan so the world point stays under cursor.
      vp.x = cx - wx * newScale;
      vp.y = cy - wy * newScale;
    }
  };

  return (
    <div ref={containerRef} className="h-full w-full relative overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
    </div>
  );
}

/** Node radius as a function of degree. */
function nodeRadius(degree: number): number {
  return 4 + Math.min(degree, 8) * 1.5;
}
