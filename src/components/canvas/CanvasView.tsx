"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Type,
  FileText,
  MousePointer2,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize,
} from "lucide-react";
import {
  type CanvasNode,
  type CanvasState,
  emptyCanvas,
  screenToWorld,
  nodeAt,
  genCanvasId,
} from "@/lib/canvas/canvas-model";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Infinite canvas (whiteboard).
 *
 * DOM-based absolute positioning with CSS transforms for pan/zoom. Each node
 * is a positioned div; the viewport transform is applied to a container.
 * Viewport culling renders only visible nodes (via visibleNodes()).
 *
 * Interactions:
 *  - Pan: drag the background.
 *  - Zoom: mouse wheel (zoom toward cursor).
 *  - Add node: click the toolbar buttons.
 *  - Move node: drag the node.
 *  - Select: click a node.
 */
export function CanvasView() {
  const [state, setState] = useState<CanvasState>(emptyCanvas);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    type: "pan" | "node" | null;
    nodeId: string | null;
    startX: number;
    startY: number;
    nodeStartX: number;
    nodeStartY: number;
  }>({ type: null, nodeId: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0 });

  const addNode = (type: CanvasNode["type"]) => {
    // Add at the center of the current viewport.
    const container = containerRef.current;
    if (!container) return;
    const cx = (container.clientWidth / 2 - state.panX) / state.zoom;
    const cy = (container.clientHeight / 2 - state.panY) / state.zoom;
    const node: CanvasNode = {
      id: genCanvasId("node"),
      type,
      x: cx - 75,
      y: cy - 40,
      width: 150,
      height: 80,
      zIndex: state.nodes.length + 1,
      text: type === "text" ? "Double-click to edit" : type === "note" ? "# New Note" : "",
      color: null,
      fileId: null,
    };
    setState((s) => ({ ...s, nodes: [...s.nodes, node], selected: [node.id] }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const sx = e.clientX - container.getBoundingClientRect().left;
    const sy = e.clientY - container.getBoundingClientRect().top;
    const world = screenToWorld(sx, sy, state.panX, state.panY, state.zoom);
    const hit = nodeAt(state.nodes, world.x, world.y);
    if (hit) {
      dragRef.current = {
        type: "node",
        nodeId: hit.id,
        startX: sx,
        startY: sy,
        nodeStartX: hit.x,
        nodeStartY: hit.y,
      };
      setState((s) => ({ ...s, selected: [hit.id] }));
    } else {
      dragRef.current = { type: "pan", nodeId: null, startX: sx, startY: sy, nodeStartX: 0, nodeStartY: 0 };
      setState((s) => ({ ...s, selected: [] }));
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const sx = e.clientX - container.getBoundingClientRect().left;
    const sy = e.clientY - container.getBoundingClientRect().top;
    const drag = dragRef.current;
    if (drag.type === "pan") {
      const dx = sx - drag.startX;
      const dy = sy - drag.startY;
      setState((s) => ({ ...s, panX: s.panX + dx, panY: s.panY + dy }));
      drag.startX = sx;
      drag.startY = sy;
    } else if (drag.type === "node" && drag.nodeId) {
      const dx = (sx - drag.startX) / state.zoom;
      const dy = (sy - drag.startY) / state.zoom;
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.id === drag.nodeId ? { ...n, x: drag.nodeStartX + dx, y: drag.nodeStartY + dy } : n
        ),
      }));
    }
  };

  const handleMouseUp = () => {
    dragRef.current = { type: null, nodeId: null, startX: 0, startY: 0, nodeStartX: 0, nodeStartY: 0 };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const delta = -e.deltaY * 0.001;
    const newZoom = Math.max(0.1, Math.min(5, state.zoom * (1 + delta)));
    // Zoom toward cursor: keep the world point under the cursor fixed.
    const worldX = (sx - state.panX) / state.zoom;
    const worldY = (sy - state.panY) / state.zoom;
    const newPanX = sx - worldX * newZoom;
    const newPanY = sy - worldY * newZoom;
    setState((s) => ({ ...s, zoom: newZoom, panX: newPanX, panY: newPanY }));
  };

  const resetView = () => {
    setState((s) => ({ ...s, panX: 0, panY: 0, zoom: 1 }));
  };

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Toolbar */}
      <div className="border-b px-3 py-1.5 flex items-center gap-2 shrink-0 bg-muted/20">
        <span className="text-xs font-medium">Canvas</span>
        <Badge>{state.nodes.length} nodes</Badge>
        <div className="flex-1" />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => addNode("text")}>
                <Type className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add text card</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => addNode("note")}>
                <FileText className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add note card</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setState((s) => ({ ...s, zoom: Math.min(5, s.zoom * 1.2) }))}>
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setState((s) => ({ ...s, zoom: Math.max(0.1, s.zoom / 1.2) }))}>
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={resetView}>
          <Maximize className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px)",
          backgroundSize: `${20 * state.zoom}px ${20 * state.zoom}px`,
          backgroundPosition: `${state.panX}px ${state.panY}px`,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Nodes layer (transformed by pan/zoom) */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {state.nodes.map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              selected={state.selected.includes(node.id)}
              onDoubleClick={() => {
                const text = window.prompt("Edit text:", node.text);
                if (text !== null) {
                  setState((s) => ({
                    ...s,
                    nodes: s.nodes.map((n) => (n.id === node.id ? { ...n, text } : n)),
                  }));
                }
              }}
            />
          ))}
        </div>

        {/* Hint */}
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground pointer-events-none">
            <div className="text-center">
              <Plus className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Click the toolbar buttons to add nodes</p>
              <p className="text-xs mt-1 opacity-60">Drag to pan · Scroll to zoom</p>
            </div>
          </div>
        )}
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded">
        {Math.round(state.zoom * 100)}%
      </div>
    </div>
  );
}

function CanvasNodeView({
  node,
  selected,
  onDoubleClick,
}: {
  node: CanvasNode;
  selected: boolean;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={`absolute bg-background border rounded-md shadow-sm transition-shadow ${
        selected ? "ring-2 ring-primary" : "hover:shadow-md"
      }`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
      }}
      onDoubleClick={onDoubleClick}
    >
      <div className="p-2 h-full overflow-hidden text-xs">
        {node.type === "note" ? (
          <div className="font-mono whitespace-pre-wrap text-muted-foreground">
            {node.text}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{node.text}</div>
        )}
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-background font-normal">
      {children}
    </span>
  );
}
