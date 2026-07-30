/**
 * Per-leaf editor mode state (Zustand).
 *
 * Modes:
 *  - 'live-preview': Default. CodeMirror with inline decorations (checkboxes,
 *    styled tokens, image widgets).
 *  - 'source': Plain CodeMirror with syntax highlighting only (no live-preview
 *    decorations).
 *  - 'reading': Fully rendered markdown (react-markdown), not editable.
 *
 * Each leaf can independently be in a different mode.
 */

"use client";

import { create } from "zustand";
import type { NodeId } from "@/lib/workspace/types";

export type EditorMode = "live-preview" | "source" | "reading";

interface EditorModeState {
  /** Per-leaf mode. Missing entry means 'live-preview' (default). */
  modes: Record<NodeId, EditorMode>;
  /** Get the mode for a leaf (defaults to 'live-preview'). */
  getMode: (leafId: NodeId) => EditorMode;
  /** Set the mode for a specific leaf. */
  setMode: (leafId: NodeId, mode: EditorMode) => void;
  /** Toggle between live-preview and reading (Obsidian Ctrl+E behavior). */
  toggleMode: (leafId: NodeId) => void;
  /** Cycle through all three modes (live-preview -> source -> reading -> ...) */
  cycleMode: (leafId: NodeId) => void;
}

const MODE_CYCLE: EditorMode[] = ["live-preview", "source", "reading"];

export const useEditorModeStore = create<EditorModeState>((set, get) => ({
  modes: {},

  getMode: (leafId) => get().modes[leafId] ?? "live-preview",

  setMode: (leafId, mode) => {
    set({ modes: { ...get().modes, [leafId]: mode } });
  },

  toggleMode: (leafId) => {
    const current = get().getMode(leafId);
    const next = current === "reading" ? "live-preview" : "reading";
    set({ modes: { ...get().modes, [leafId]: next } });
  },

  cycleMode: (leafId) => {
    const current = get().getMode(leafId);
    const idx = MODE_CYCLE.indexOf(current);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    set({ modes: { ...get().modes, [leafId]: next } });
  },
}));
