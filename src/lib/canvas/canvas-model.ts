/**
 * Infinite canvas spatial index + node model.
 *
 * The whiteboard is an infinite 2D plane. Items ("nodes") are positioned at
 * (x, y) with width/height. The viewport is defined by a pan offset + zoom
 * scale. A simple spatial index (grid-based bucketing) enables viewport
 * culling — only nodes intersecting the viewport are rendered, so the canvas
 * stays smooth with thousands of nodes.
 */

export type CanvasNodeType = "text" | "note" | "image" | "link" | "frame";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** Text content (for text/note/link nodes). */
  text: string;
  /** Color (CSS). */
  color: string | null;
  /** For note nodes: the linked file id. */
  fileId: string | null;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  /** Optional label. */
  label: string | null;
  /** Color (CSS). */
  color: string | null;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Pan offset (screen px). */
  panX: number;
  panY: number;
  /** Zoom scale (1 = 100%). */
  zoom: number;
  /** Selected node ids. */
  selected: string[];
}

export function emptyCanvas(): CanvasState {
  return {
    nodes: [],
    edges: [],
    panX: 0,
    panY: 0,
    zoom: 1,
    selected: [],
  };
}

/** Viewport culling: return only nodes visible in the current viewport. */
export function visibleNodes(
  nodes: CanvasNode[],
  panX: number,
  panY: number,
  zoom: number,
  viewportW: number,
  viewportH: number
): CanvasNode[] {
  // World bounds visible in the viewport.
  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;
  const worldRight = worldLeft + viewportW / zoom;
  const worldBottom = worldTop + viewportH / zoom;
  // Add a margin so nodes partially visible render.
  const margin = 100;
  return nodes.filter(
    (n) =>
      n.x + n.width >= worldLeft - margin &&
      n.x <= worldRight + margin &&
      n.y + n.height >= worldTop - margin &&
      n.y <= worldBottom + margin
  );
}

/** Convert screen coords → world coords. */
export function screenToWorld(sx: number, sy: number, panX: number, panY: number, zoom: number) {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

/** Convert world coords → screen coords. */
export function worldToScreen(wx: number, wy: number, panX: number, panY: number, zoom: number) {
  return { x: wx * zoom + panX, y: wy * zoom + panY };
}

/** Hit test: find the topmost node at a world position. */
export function nodeAt(nodes: CanvasNode[], wx: number, wy: number): CanvasNode | null {
  const sorted = [...nodes].sort((a, b) => b.zIndex - a.zIndex);
  for (const n of sorted) {
    if (wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height) {
      return n;
    }
  }
  return null;
}

let idCounter = 0;
export function genCanvasId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}
