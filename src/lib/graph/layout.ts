/**
 * Force-directed graph layout engine.
 *
 * Implements a simple N-body simulation with:
 *  - Charge repulsion: every node repels every other node (O(n²) but fine for
 *    vaults < 1000 notes; spatial hashing would optimize for larger graphs).
 *  - Spring attraction: linked nodes attract each other (Hooke's law).
 *  - Centering: a weak gravitational pull toward the origin keeps the graph
 *    from drifting off-screen.
 *  - Velocity damping: prevents oscillation.
 *
 * Integration is Verlet-style (position += velocity, velocity *= damping).
 * The simulation runs in fixed time-steps; `tick()` advances one step.
 *
 * Node positions are stored in a Map<fileId, {x, y, vx, vy}>. The renderer
 * reads these positions each frame.
 */

import type { FileId } from "@/lib/vault/types";
import type { LinkIndex } from "@/lib/index/link-index";

export interface GraphNode {
  id: FileId;
  /** Display label (note name). */
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** True if this node is pinned (won't move during simulation). */
  pinned: boolean;
  /** Number of links (for sizing). */
  degree: number;
}

export interface GraphEdge {
  source: FileId;
  target: FileId;
}

export interface GraphLayout {
  nodes: Map<FileId, GraphNode>;
  edges: GraphEdge[];
}

export interface LayoutOptions {
  /** Charge repulsion strength (higher = nodes spread more). */
  charge: number;
  /** Spring rest length (linked nodes settle at this distance). */
  linkDistance: number;
  /** Spring stiffness. */
  springStrength: number;
  /** Centering force strength. */
  gravity: number;
  /** Velocity damping (0-1, lower = more friction). */
  damping: number;
  /** Max velocity per tick (prevents explosion). */
  maxVelocity: number;
}

export const DEFAULT_OPTIONS: LayoutOptions = {
  charge: 600,
  linkDistance: 120,
  springStrength: 0.08,
  gravity: 0.015,
  damping: 0.85,
  maxVelocity: 30,
};

/**
 * Build a graph layout from the link index.
 * Nodes are placed in a circle initially (phased by index to avoid overlap).
 * The layout is pre-stabilized so it opens in a settled state.
 *
 * @param skipStabilize If true, skip initial stabilization (caller will stabilize manually).
 */
export function buildGraphLayout(
  index: LinkIndex,
  labels: Map<FileId, string>,
  opts: Partial<LayoutOptions> = {},
  skipStabilize = false
): GraphLayout {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const nodes = new Map<FileId, GraphNode>();
  const edges: GraphEdge[] = [];

  // Create nodes.
  const fileIds = [...index.metadata.keys()];
  const radius = Math.max(50, fileIds.length * 5);
  fileIds.forEach((id, i) => {
    const angle = (i / fileIds.length) * Math.PI * 2;
    nodes.set(id, {
      id,
      label: labels.get(id) ?? id,
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
      pinned: false,
      degree: 0,
    });
  });

  // Create edges (deduplicated — one edge per unique pair).
  const edgeSet = new Set<string>();
  for (const [sourceId, outEdges] of index.outgoing) {
    for (const edge of outEdges) {
      if (edge.target === null) continue;
      if (!nodes.has(edge.target)) continue;
      // Use sorted pair as key to deduplicate bidirectional edges.
      const key = sourceId < edge.target ? `${sourceId}|${edge.target}` : `${edge.target}|${sourceId}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: sourceId, target: edge.target });
      // Increment degree for both endpoints.
      const s = nodes.get(sourceId);
      const t = nodes.get(edge.target);
      if (s) s.degree++;
      if (t) t.degree++;
    }
  }

  void options;
  const layout: GraphLayout = { nodes, edges };

  // Pre-stabilize the layout so it opens already settled (not as a circle).
  if (!skipStabilize) {
    stabilize(layout, options, 200);
  }

  return layout;
}

/**
 * Advance the simulation by one tick.
 * O(n² + e) where n = nodes, e = edges.
 */
export function tickLayout(layout: GraphLayout, opts: LayoutOptions = DEFAULT_OPTIONS): void {
  const { nodes, edges } = layout;
  const nodeArr = [...nodes.values()];

  // 1. Charge repulsion (all pairs).
  for (let i = 0; i < nodeArr.length; i++) {
    const a = nodeArr[i];
    for (let j = i + 1; j < nodeArr.length; j++) {
      const b = nodeArr[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist2 = dx * dx + dy * dy;
      if (dist2 < 1) {
        // Coincident nodes — nudge apart.
        dx = (Math.random() - 0.5) * 2;
        dy = (Math.random() - 0.5) * 2;
        dist2 = dx * dx + dy * dy + 1;
      }
      const dist = Math.sqrt(dist2);
      const force = opts.charge / dist2;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!b.pinned) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // 2. Spring attraction (edges only).
  for (const edge of edges) {
    const a = nodes.get(edge.source);
    const b = nodes.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - opts.linkDistance;
    const force = displacement * opts.springStrength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.pinned) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.pinned) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // 3. Centering gravity + velocity integration.
  for (const node of nodeArr) {
    if (node.pinned) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    // Gravity toward origin.
    node.vx -= node.x * opts.gravity;
    node.vy -= node.y * opts.gravity;
    // Damping.
    node.vx *= opts.damping;
    node.vy *= opts.damping;
    // Clamp velocity.
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > opts.maxVelocity) {
      node.vx = (node.vx / speed) * opts.maxVelocity;
      node.vy = (node.vy / speed) * opts.maxVelocity;
    }
    // Integrate.
    node.x += node.vx;
    node.y += node.vy;
  }
}

/**
 * Run the simulation until it stabilizes (total kinetic energy < threshold)
 * or maxIterations is reached. Used for the initial layout.
 */
export function stabilize(
  layout: GraphLayout,
  opts: LayoutOptions = DEFAULT_OPTIONS,
  maxIterations = 300
): void {
  for (let i = 0; i < maxIterations; i++) {
    tickLayout(layout, opts);
    // Check kinetic energy.
    let energy = 0;
    for (const node of layout.nodes.values()) {
      energy += node.vx * node.vx + node.vy * node.vy;
    }
    if (energy < 0.5) break;
  }
}

/** Pin a node at a position (user drag). */
export function pinNode(layout: GraphLayout, id: FileId, x: number, y: number): void {
  const node = layout.nodes.get(id);
  if (!node) return;
  node.x = x;
  node.y = y;
  node.vx = 0;
  node.vy = 0;
  node.pinned = true;
}

/** Unpin a node (resume simulation). */
export function unpinNode(layout: GraphLayout, id: FileId): void {
  const node = layout.nodes.get(id);
  if (node) node.pinned = false;
}

/**
 * BFS from a source node up to N depths. Returns the subgraph (nodes + edges)
 * for the local graph view.
 */
export function localSubgraph(
  index: LinkIndex,
  sourceId: FileId,
  depth: number
): { nodeIds: Set<FileId>; edges: GraphEdge[] } {
  const visited = new Set<FileId>([sourceId]);
  const frontier: FileId[] = [sourceId];
  const edges: GraphEdge[] = [];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: FileId[] = [];
    for (const id of frontier) {
      // Outgoing.
      const outEdges = index.outgoing.get(id) ?? [];
      for (const e of outEdges) {
        if (e.target === null) continue;
        edges.push({ source: id, target: e.target });
        if (!visited.has(e.target)) {
          visited.add(e.target);
          next.push(e.target);
        }
      }
      // Incoming (backlinks).
      const inEdges = index.incoming.get(id) ?? [];
      for (const e of inEdges) {
        edges.push({ source: e.source, target: id });
        if (!visited.has(e.source)) {
          visited.add(e.source);
          next.push(e.source);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }

  return { nodeIds: visited, edges };
}
