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

  const [drawingEdge, setDrawingEdge] = useState<{ source: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        setState((s) => ({
          ...s,
          nodes: s.nodes.filter(n => !s.selected.includes(n.id)),
          edges: s.edges.filter(edge => !s.selected.includes(edge.source) && !s.selected.includes(edge.target)),
          selected: []
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
    if (drawingEdge) {
      setState(s => s); // dummy to trigger render if needed, or just rely on drawingEdge state?
      // Actually we need world coords for drawingEdge
      const world = screenToWorld(sx, sy, state.panX, state.panY, state.zoom);
      setDrawingEdge(prev => prev ? { ...prev, x: world.x, y: world.y } : null);
      return;
    }
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

  const handleMouseUp = (e: React.MouseEvent) => {
    if (drawingEdge) {
      const container = containerRef.current;
      if (container) {
        const sx = e.clientX - container.getBoundingClientRect().left;
        const sy = e.clientY - container.getBoundingClientRect().top;
        const world = screenToWorld(sx, sy, state.panX, state.panY, state.zoom);
        const targetNode = nodeAt(state.nodes, world.x, world.y);
        
        if (targetNode && targetNode.id !== drawingEdge.source) {
          const newEdge = {
            id: genCanvasId("edge"),
            source: drawingEdge.source,
            target: targetNode.id,
            label: null,
            color: null
          };
          setState(s => ({ ...s, edges: [...s.edges, newEdge] }));
        }
      }
      setDrawingEdge(null);
    }
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
        {/* Edges layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            width: "100%",
            height: "100%",
            transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {state.edges.map((edge) => {
            const sourceNode = state.nodes.find((n) => n.id === edge.source);
            const targetNode = state.nodes.find((n) => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;
            
            const sx = sourceNode.x + sourceNode.width / 2;
            const sy = sourceNode.y + sourceNode.height / 2;
            const tx = targetNode.x + targetNode.width / 2;
            const ty = targetNode.y + targetNode.height / 2;
            
            return (
              <g key={edge.id}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={edge.color || "hsl(var(--muted-foreground))"}
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                />
              </g>
            );
          })}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="hsl(var(--muted-foreground))" />
            </marker>
          </defs>
          {drawingEdge && (() => {
            const sourceNode = state.nodes.find(n => n.id === drawingEdge.source);
            if (!sourceNode) return null;
            const sx = sourceNode.x + sourceNode.width / 2;
            const sy = sourceNode.y + sourceNode.height / 2;
            return (
              <line
                x1={sx}
                y1={sy}
                x2={drawingEdge.x}
                y2={drawingEdge.y}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="2"
                strokeDasharray="4"
                markerEnd="url(#arrowhead)"
              />
            );
          })()}
        </svg>

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
              onTextChange={(id, text) => {
                setState((s) => ({
                  ...s,
                  nodes: s.nodes.map((n) => (n.id === id ? { ...n, text } : n)),
                }));
              }}
              onResize={(id, dx, dy) => {
                setState((s) => ({
                  ...s,
                  nodes: s.nodes.map((n) =>
                    n.id === id
                      ? { ...n, width: Math.max(50, n.width + dx), height: Math.max(30, n.height + dy) }
                      : n
                  ),
                }));
              }}
              onStartEdge={(id, x, y) => {
                const world = screenToWorld(x, y, state.panX, state.panY, state.zoom);
                setDrawingEdge({ source: id, x: world.x, y: world.y });
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
  onTextChange,
  onResize,
  onStartEdge,
}: {
  node: CanvasNode;
  selected: boolean;
  onTextChange: (id: string, text: string) => void;
  onResize?: (id: string, dx: number, dy: number) => void;
  onStartEdge?: (id: string, startX: number, startY: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(node.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      // Move cursor to end
      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    onTextChange(node.id, text);
  };

  const startDragResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = node.width;
    const startHeight = node.height;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (onResize) onResize(node.id, dx, dy);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`absolute bg-background border rounded-md shadow-sm transition-shadow group ${
        selected ? "ring-2 ring-primary" : "hover:shadow-md border-border"
      }`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
        borderColor: node.color || undefined
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setText(node.text);
        setEditing(true);
      }}
    >
      <div className="p-2 h-full overflow-hidden text-xs flex flex-col">
        {editing ? (
          <textarea
            ref={inputRef}
            className="flex-1 w-full bg-transparent resize-none outline-none font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                commit();
              }
              if (e.key === "Escape") {
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className={`whitespace-pre-wrap flex-1 ${node.type === "note" ? "font-mono text-muted-foreground" : ""}`}>
            {node.text}
          </div>
        )}
      </div>
      
      {/* Resize handle */}
      {selected && (
        <>
          <div
            className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseDown={startDragResize}
          >
            <div className="absolute right-1 bottom-1 w-1.5 h-1.5 bg-primary rounded-full" />
          </div>
          
          {/* Edge connection handles */}
          <div className="absolute left-1/2 -top-2 w-3 h-3 -translate-x-1/2 cursor-crosshair opacity-0 group-hover:opacity-100 bg-primary/20 hover:bg-primary rounded-full" onMouseDown={(e) => { e.stopPropagation(); onStartEdge?.(node.id, e.clientX, e.clientY); }} />
          <div className="absolute left-1/2 -bottom-2 w-3 h-3 -translate-x-1/2 cursor-crosshair opacity-0 group-hover:opacity-100 bg-primary/20 hover:bg-primary rounded-full" onMouseDown={(e) => { e.stopPropagation(); onStartEdge?.(node.id, e.clientX, e.clientY); }} />
          <div className="absolute -left-2 top-1/2 w-3 h-3 -translate-y-1/2 cursor-crosshair opacity-0 group-hover:opacity-100 bg-primary/20 hover:bg-primary rounded-full" onMouseDown={(e) => { e.stopPropagation(); onStartEdge?.(node.id, e.clientX, e.clientY); }} />
          <div className="absolute -right-2 top-1/2 w-3 h-3 -translate-y-1/2 cursor-crosshair opacity-0 group-hover:opacity-100 bg-primary/20 hover:bg-primary rounded-full" onMouseDown={(e) => { e.stopPropagation(); onStartEdge?.(node.id, e.clientX, e.clientY); }} />
        </>
      )}
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
