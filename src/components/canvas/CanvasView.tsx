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
  Undo2,
  Redo2,
  Palette,
} from "lucide-react";
import {
  type CanvasNode,
  type CanvasState,
  emptyCanvas,
  screenToWorld,
  nodeAt,
  genCanvasId,
  visibleNodes,
} from "@/lib/canvas/canvas-model";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── Undo / Redo history ────────────────────────────────────────────────────
const MAX_HISTORY = 50;

interface HistoryStack {
  past: CanvasState[];
  future: CanvasState[];
}

function pushHistory(hist: HistoryStack, state: CanvasState): HistoryStack {
  const past = [...hist.past, state].slice(-MAX_HISTORY);
  return { past, future: [] };
}

function undo(hist: HistoryStack, current: CanvasState): { state: CanvasState; history: HistoryStack } | null {
  if (hist.past.length === 0) return null;
  const prev = hist.past[hist.past.length - 1];
  return {
    state: prev,
    history: {
      past: hist.past.slice(0, -1),
      future: [current, ...hist.future].slice(0, MAX_HISTORY),
    },
  };
}

function redo(hist: HistoryStack, current: CanvasState): { state: CanvasState; history: HistoryStack } | null {
  if (hist.future.length === 0) return null;
  const next = hist.future[0];
  return {
    state: next,
    history: {
      past: [...hist.past, current],
      future: hist.future.slice(1),
    },
  };
}

// ── Color palette for node coloring ────────────────────────────────────────
const NODE_COLORS = [
  null, // default (no color)
  "#ef4444", "#f97316", "#f59e0b", "#22c55e",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

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
 *  - Select: click a node. Shift+click to multi-select.
 *  - Delete: Delete/Backspace removes selected nodes.
 *  - Undo/Redo: Ctrl+Z / Ctrl+Y.
 */
export function CanvasView() {
  const [state, setState] = useState<CanvasState>(emptyCanvas);
  const [history, setHistory] = useState<HistoryStack>({ past: [], future: [] });
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
  const [showColorPicker, setShowColorPicker] = useState(false);

  /** Save current state to undo history before a destructive operation. */
  const snapshot = useCallback(() => {
    setState((s) => {
      setHistory((h) => pushHistory(h, s));
      return s;
    });
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected nodes
      if ((e.key === "Delete" || e.key === "Backspace") && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        snapshot();
        setState((s) => ({
          ...s,
          nodes: s.nodes.filter(n => !s.selected.includes(n.id)),
          edges: s.edges.filter(edge => !s.selected.includes(edge.source) && !s.selected.includes(edge.target)),
          selected: []
        }));
      }
      // Undo: Ctrl+Z
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        setState((current) => {
          const result = undo(history, current);
          if (!result) return current;
          setHistory(result.history);
          return result.state;
        });
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) ||
          (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        setState((current) => {
          const result = redo(history, current);
          if (!result) return current;
          setHistory(result.history);
          return result.state;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history, snapshot]);

  // ── Non-passive wheel handler (fix #3) ───────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const delta = -e.deltaY * 0.001;
      setState((s) => {
        const newZoom = Math.max(0.1, Math.min(5, s.zoom * (1 + delta)));
        // Zoom toward cursor: keep the world point under the cursor fixed.
        const worldX = (sx - s.panX) / s.zoom;
        const worldY = (sy - s.panY) / s.zoom;
        const newPanX = sx - worldX * newZoom;
        const newPanY = sy - worldY * newZoom;
        return { ...s, zoom: newZoom, panX: newPanX, panY: newPanY };
      });
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const addNode = (type: CanvasNode["type"]) => {
    snapshot();
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
      // Fix #6: Shift+click for multi-select
      if (e.shiftKey) {
        setState((s) => ({
          ...s,
          selected: s.selected.includes(hit.id)
            ? s.selected.filter((id) => id !== hit.id)
            : [...s.selected, hit.id],
        }));
      } else {
        setState((s) => ({
          ...s,
          selected: s.selected.includes(hit.id) ? s.selected : [hit.id],
        }));
      }
      dragRef.current = {
        type: "node",
        nodeId: hit.id,
        startX: sx,
        startY: sy,
        nodeStartX: hit.x,
        nodeStartY: hit.y,
      };
    } else {
      dragRef.current = { type: "pan", nodeId: null, startX: sx, startY: sy, nodeStartX: 0, nodeStartY: 0 };
      if (!e.shiftKey) {
        setState((s) => ({ ...s, selected: [] }));
      }
      setShowColorPicker(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const sx = e.clientX - container.getBoundingClientRect().left;
    const sy = e.clientY - container.getBoundingClientRect().top;
    const drag = dragRef.current;
    if (drawingEdge) {
      // Fix #11: use container-relative coords for screenToWorld
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
      // Move all selected nodes together
      setState((s) => {
        const selectedSet = new Set(s.selected);
        if (selectedSet.size > 1 && selectedSet.has(drag.nodeId!)) {
          // Multi-select drag: move all selected nodes by the same delta
          const primaryNode = s.nodes.find(n => n.id === drag.nodeId);
          if (!primaryNode) return s;
          return {
            ...s,
            nodes: s.nodes.map((n) => {
              if (!selectedSet.has(n.id)) return n;
              if (n.id === drag.nodeId) {
                return { ...n, x: drag.nodeStartX + dx, y: drag.nodeStartY + dy };
              }
              // Other selected nodes: apply same delta
              return { ...n, x: n.x + (dx - (primaryNode.x - drag.nodeStartX)), y: n.y + (dy - (primaryNode.y - drag.nodeStartY)) };
            }),
          };
        }
        return {
          ...s,
          nodes: s.nodes.map((n) =>
            n.id === drag.nodeId ? { ...n, x: drag.nodeStartX + dx, y: drag.nodeStartY + dy } : n
          ),
        };
      });
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
          snapshot();
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

  const resetView = () => {
    setState((s) => ({ ...s, panX: 0, panY: 0, zoom: 1 }));
  };

  /** Zoom to fit all nodes in view. */
  const zoomToFit = () => {
    const container = containerRef.current;
    if (!container || state.nodes.length === 0) return;
    const minX = Math.min(...state.nodes.map(n => n.x));
    const minY = Math.min(...state.nodes.map(n => n.y));
    const maxX = Math.max(...state.nodes.map(n => n.x + n.width));
    const maxY = Math.max(...state.nodes.map(n => n.y + n.height));
    const contentW = maxX - minX + 100; // padding
    const contentH = maxY - minY + 100;
    const zoom = Math.min(
      container.clientWidth / contentW,
      container.clientHeight / contentH,
      2 // max zoom
    );
    const panX = (container.clientWidth - contentW * zoom) / 2 - minX * zoom + 50 * zoom;
    const panY = (container.clientHeight - contentH * zoom) / 2 - minY * zoom + 50 * zoom;
    setState((s) => ({ ...s, zoom, panX, panY }));
  };

  const setNodeColor = (color: string | null) => {
    snapshot();
    setState((s) => ({
      ...s,
      nodes: s.nodes.map((n) =>
        s.selected.includes(n.id) ? { ...n, color } : n
      ),
    }));
    setShowColorPicker(false);
  };

  // Fix #5: Apply viewport culling
  const container = containerRef.current;
  const renderedNodes = container
    ? visibleNodes(state.nodes, state.panX, state.panY, state.zoom, container.clientWidth, container.clientHeight)
    : state.nodes;

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Toolbar */}
      <div className="border-b px-3 py-1.5 flex items-center gap-2 shrink-0 bg-muted/20">
        <span className="text-xs font-medium">Canvas</span>
        <CanvasBadge>{state.nodes.length} nodes</CanvasBadge>
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
        {/* Color picker toggle */}
        {state.selected.length > 0 && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowColorPicker(v => !v)}>
                  <Palette className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Color selected nodes</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setState((current) => { const result = undo(history, current); if (!result) return current; setHistory(result.history); return result.state; }); }}>
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setState((current) => { const result = redo(history, current); if (!result) return current; setHistory(result.history); return result.state; }); }}>
                <Redo2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
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

      {/* Color picker dropdown */}
      {showColorPicker && state.selected.length > 0 && (
        <div className="absolute top-12 right-3 z-50 bg-popover border rounded-lg shadow-lg p-2 flex gap-1.5 flex-wrap max-w-[200px]">
          {NODE_COLORS.map((color, i) => (
            <button
              key={i}
              className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: color || "hsl(var(--background))",
                borderColor: color || "hsl(var(--border))",
              }}
              onClick={() => setNodeColor(color)}
              title={color || "Default"}
            />
          ))}
        </div>
      )}

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
        // Wheel handled by non-passive addEventListener in useEffect
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

        {/* Nodes layer (transformed by pan/zoom) — viewport culled */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {renderedNodes.map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              selected={state.selected.includes(node.id)}
              onTextChange={(id, text) => {
                snapshot();
                setState((s) => ({
                  ...s,
                  nodes: s.nodes.map((n) => (n.id === id ? { ...n, text } : n)),
                }));
              }}
              onResize={(id, w, h) => {
                setState((s) => ({
                  ...s,
                  nodes: s.nodes.map((n) =>
                    n.id === id
                      ? { ...n, width: Math.max(50, w), height: Math.max(30, h) }
                      : n
                  ),
                }));
              }}
              onResizeStart={() => snapshot()}
              onStartEdge={(id, clientX, clientY) => {
                // Fix #11: Convert clientX/clientY to container-relative, then to world
                const cont = containerRef.current;
                if (!cont) return;
                const rect = cont.getBoundingClientRect();
                const sx = clientX - rect.left;
                const sy = clientY - rect.top;
                const world = screenToWorld(sx, sy, state.panX, state.panY, state.zoom);
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
              <p className="text-xs mt-1 opacity-60">Drag to pan · Scroll to zoom · Shift+click multi-select</p>
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
  onResizeStart,
  onStartEdge,
}: {
  node: CanvasNode;
  selected: boolean;
  onTextChange: (id: string, text: string) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onResizeStart?: () => void;
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

  // Fix #1: Resize uses absolute width/height from start, not accumulated deltas
  const startDragResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResizeStart?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = node.width;
    const startHeight = node.height;

    const onMove = (me: MouseEvent) => {
      const newWidth = startWidth + (me.clientX - startX);
      const newHeight = startHeight + (me.clientY - startY);
      if (onResize) onResize(node.id, newWidth, newHeight);
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
      {/* Color indicator strip */}
      {node.color && (
        <div
          className="absolute top-0 left-0 right-0 h-1 rounded-t-md"
          style={{ backgroundColor: node.color }}
        />
      )}
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

/** Fix #17: Renamed from Badge to CanvasBadge to avoid shadcn conflict. */
function CanvasBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-background font-normal">
      {children}
    </span>
  );
}
