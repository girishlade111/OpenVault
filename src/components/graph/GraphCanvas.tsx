"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import type { FileId } from "@/lib/vault/types";
import type { GraphLayout, LayoutOptions } from "@/lib/graph/layout";
import { tickLayout, pinNode, unpinNode } from "@/lib/graph/layout";

/** Handle exposed via ref so parent can call zoomToFit imperatively. */
export interface GraphCanvasHandle {
  zoomToFit: () => void;
}

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
 *  - Node hover -> label shown.
 *  - Node click -> onNodeClick callback.
 *  - Node drag -> pin at cursor position (unpins on release).
 *  - Active node highlighted with a ring.
 *  - Node size scales with degree.
 *  - Auto zoom-to-fit on initial mount.
 *  - Keyboard shortcuts: +/- zoom, 0 reset, f zoom-to-fit.
 *  - Subtle glow effect on nodes.
 *  - Labels visible at higher zoom levels.
 *
 * The canvas is HiDPI-aware (scales by devicePixelRatio).
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
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
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const initialFitDone = useRef(false);

  // Viewport state: pan offset + zoom scale.
  const viewportRef = useRef({ x: 0, y: 0, scale: 1 });
  const [hoveredId, setHoveredId] = useState<FileId | null>(null);
  const dragRef = useRef<{
    type: "pan" | "node" | null;
    nodeId: FileId | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({ type: null, nodeId: null, startX: 0, startY: 0, lastX: 0, lastY: 0 });

  // Zoom-to-fit helper.
  const performZoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || layout.nodes.size === 0) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    zoomToFit(layout, viewportRef, w, h);
  }, [layout]);

  // Expose zoomToFit via imperative handle.
  useImperativeHandle(ref, () => ({
    zoomToFit: performZoomToFit,
  }), [performZoomToFit]);

  // Convert screen coords -> world coords.
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
  const nodeAtScreen = useCallback(
    (sx: number, sy: number): FileId | null => {
      const world = screenToWorld(sx, sy);
      const nodeArr = [...layout.nodes.values()];
      for (let i = nodeArr.length - 1; i >= 0; i--) {
        const n = nodeArr[i];
        const r = nodeRadius(n.degree);
        const dx = world.x - n.x;
        const dy = world.y - n.y;
        if (dx * dx + dy * dy <= (r + 2) * (r + 2)) return n.id;
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
      // If filtering, dim edges to hidden nodes
      if (highlightedIds && (!highlightedIds.has(a.id) || !highlightedIds.has(b.id))) {
        ctx.globalAlpha = 0.05;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Draw nodes.
    for (const node of layout.nodes.values()) {
      const r = nodeRadius(node.degree);
      const isActive = node.id === activeFileId;
      const isHovered = node.id === hoveredId;
      const isHighlighted = highlightedIds?.has(node.id);

      // If filtering is active and this node is hidden, render very faintly
      if (highlightedIds && !isHighlighted && !isActive && !isHovered) {
        ctx.globalAlpha = 0.08;
      }

      const c = nodeColors?.get(node.id) || nodeColor;

      // Glow/bloom effect - subtle semi-transparent circle behind node
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = activeColor + "30";
      } else if (isHovered) {
        ctx.fillStyle = c.includes("hsl") ? "hsla(var(--primary) / 0.2)" : c + "30";
      } else {
        ctx.fillStyle = c.includes("hsl") ? "hsla(var(--primary) / 0.12)" : c + "20";
      }
      ctx.fill();

      // Active ring.
      if (isActive) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
        ctx.fillStyle = activeColor + "40";
        ctx.fill();
      }

      // Node circle.
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      if (isActive) {
        ctx.fillStyle = activeColor;
      } else if (isHovered) {
        ctx.fillStyle = c;
        ctx.globalAlpha = 1;
      } else if (highlightedIds && !isHighlighted) {
        ctx.fillStyle = c;
      } else {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.85;
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      // Labels: show on hover, for active, if showAllLabels, or when zoomed in enough
      const showLabel = isHovered || isActive || showAllLabels || vp.scale > 1.2;
      if (showLabel) {
        // Clamp font size between 9 and 14 screen pixels
        const fontSize = Math.max(9, Math.min(14, 12 * vp.scale)) / vp.scale;
        ctx.fillStyle = "hsl(var(--foreground))";
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        // Fade labels slightly when zoomed out unless hovered/active
        if (!isHovered && !isActive && vp.scale < 1.5) {
          ctx.globalAlpha = 0.7;
        }
        ctx.fillText(node.label, node.x, node.y + r + 4);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }, [layout, activeFileId, hoveredId, highlightedIds, nodeColor, nodeColors, activeColor, edgeColor, backgroundColor, showAllLabels]);

  // Animation loop: tick simulation + render + auto zoom-to-fit on first frame.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      if (simulate) {
        tickLayout(layout, options);
      }
      render();
      // Auto zoom-to-fit on the first frame when nodes exist
      if (!initialFitDone.current && layout.nodes.size > 0 && containerRef.current) {
        performZoomToFit();
        initialFitDone.current = true;
      }
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [simulate, layout, options, render, performZoomToFit]);



  // Non-passive wheel handler for zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const newScale = Math.max(0.1, Math.min(5, viewportRef.current.scale * (1 + delta)));
      // Zoom toward cursor.
      const rect = canvas.getBoundingClientRect();
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
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  // Keyboard shortcuts when canvas container is focused.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const vp = viewportRef.current;
      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          vp.scale = Math.min(5, vp.scale * 1.2);
          break;
        case "-":
          e.preventDefault();
          vp.scale = Math.max(0.1, vp.scale / 1.2);
          break;
        case "0":
          e.preventDefault();
          vp.x = 0;
          vp.y = 0;
          vp.scale = 1;
          break;
        case "f":
        case "F":
          e.preventDefault();
          performZoomToFit();
          break;
      }
    };
    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [performZoomToFit]);

  // Mouse handlers.
  const handleMouseDown = (e: React.MouseEvent) => {
    // Focus the container for keyboard shortcuts
    containerRef.current?.focus();
    const id = nodeAtScreen(e.clientX, e.clientY);
    if (id) {
      const world = screenToWorld(e.clientX, e.clientY);
      dragRef.current = {
        type: "node",
        nodeId: id,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      pinNode(layout, id, world.x, world.y);
    } else {
      dragRef.current = {
        type: "pan",
        nodeId: null,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
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
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else {
      // Hover detection.
      const id = nodeAtScreen(e.clientX, e.clientY);
      setHoveredId(id);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = id ? "pointer" : "grab";
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragRef.current.type === "node" && dragRef.current.nodeId) {
      const moved = Math.abs(e.clientX - dragRef.current.startX) + Math.abs(e.clientY - dragRef.current.startY);
      if (moved < 4 && onNodeClick) {
        onNodeClick(dragRef.current.nodeId);
      }
      unpinNode(layout, dragRef.current.nodeId);
    }
    dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden outline-none"
      tabIndex={0}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
});

/** Zoom the viewport to fit all nodes with padding. */
export function zoomToFit(
  layout: GraphLayout,
  viewportRef: React.MutableRefObject<{ x: number; y: number; scale: number }>,
  containerWidth: number,
  containerHeight: number
) {
  if (layout.nodes.size === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of layout.nodes.values()) {
    const r = nodeRadius(node.degree);
    minX = Math.min(minX, node.x - r);
    minY = Math.min(minY, node.y - r);
    maxX = Math.max(maxX, node.x + r);
    maxY = Math.max(maxY, node.y + r);
  }
  const graphW = maxX - minX + 80;
  const graphH = maxY - minY + 80;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scale = Math.min(containerWidth / graphW, containerHeight / graphH, 2);
  viewportRef.current.scale = scale;
  viewportRef.current.x = -centerX * scale;
  viewportRef.current.y = -centerY * scale;
}

/** Node radius as a function of degree. */
function nodeRadius(degree: number): number {
  return 4 + Math.min(degree, 8) * 1.5;
}
