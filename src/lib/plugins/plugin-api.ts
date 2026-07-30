/**
 * Plugin API scaffold.
 *
 * Defines the plugin manifest format, lifecycle hooks, and the markdown
 * post-processor pipeline that plugins can register into.
 *
 * Plugin lifecycle:
 *  1. `onload()` — called when the plugin is loaded (app boot or user enable).
 *     Plugins register commands, post-processors, and event handlers here.
 *  2. `onunload()` — called when the plugin is unloaded. Plugins clean up.
 *
 * Event hooks (publish/subscribe):
 *  - onLayoutReady   — fired once when the workspace tree is ready.
 *  - onFileOpen      — fired when a file becomes active.
 *  - onModify        — fired when a file's content changes.
 *  - onMarkdownRender — fired after the editor renders markdown (for
 *                       post-processors that mutate the DOM).
 *
 * Post-processors: plugins register callbacks that receive the rendered DOM
 * and can mutate it (e.g. turn text into interactive widgets, render Mermaid
 * diagrams, add Dataview tables).
 */

import type { FileId } from "@/lib/vault/types";
import { registerCommand, unregisterCommand, type Command } from "@/lib/automation/hotkeys";
import { useVaultStore } from "@/store/vault-store";
import type { WorkspaceNode, LeafNode } from "@/lib/workspace/types";

/** Plugin manifest — declared in the plugin's manifest.json. */
export interface PluginManifest {
  /** Unique id, e.g. "mermaid-renderer". */
  id: string;
  /** Display name. */
  name: string;
  /** Semantic version. */
  version: string;
  /** Author. */
  author: string;
  /** Short description. */
  description: string;
  /** Whether the plugin is enabled. */
  enabled: boolean;
}

/** The API surface a plugin receives. */
export interface PluginApi {
  /** The plugin's manifest. */
  manifest: PluginManifest;
  /** Register a command. */
  registerCommand: (cmd: Command) => void;
  /** Register a markdown post-processor. */
  registerMarkdownPostProcessor: (fn: PostProcessorFn) => void;
  /** Subscribe to an event hook. Returns an unsubscribe function. */
  on: (event: PluginEvent, handler: EventHandler) => () => void;
  /** Read a file's content. */
  readFile: (fileId: FileId) => Promise<string | null>;
  /** Write a file's content. */
  writeFile: (fileId: FileId, content: string) => Promise<void>;
  /** Get the active file id. */
  getActiveFile: () => FileId | null;
}

/** A markdown post-processor: receives the rendered DOM container + context. */
export type PostProcessorFn = (container: HTMLElement, context: PostProcessorContext) => void;

export interface PostProcessorContext {
  fileId: FileId;
  /** The source markdown text. */
  source: string;
}

/** Plugin lifecycle events. */
export type PluginEvent = "onLayoutReady" | "onFileOpen" | "onModify" | "onMarkdownRender";

/** Event handler — receives event-specific payload. */
export type EventHandler = (payload: EventPayload) => void;

export interface EventPayload {
  type: PluginEvent;
  fileId?: FileId;
  content?: string;
  container?: HTMLElement;
}

/** A loaded plugin instance. */
export interface LoadedPlugin {
  manifest: PluginManifest;
  api: PluginApi;
  cleanup: () => void;
}

// --- plugin registry -------------------------------------------------------

const loadedPlugins = new Map<string, LoadedPlugin>();
const eventSubscribers: Map<PluginEvent, Set<EventHandler>> = new Map();
const postProcessors: PostProcessorFn[] = [];

/**
 * Load a plugin. The plugin's `onload` function receives a `PluginApi` and
 * registers its commands/processors/handlers.
 */
export function loadPlugin(
  manifest: PluginManifest,
  onload: (api: PluginApi) => void
): LoadedPlugin | null {
  if (loadedPlugins.has(manifest.id)) return null;
  if (!manifest.enabled) return null;

  const unsubscribers: (() => void)[] = [];

  const api: PluginApi = {
    manifest,
    registerCommand: (cmd: Command) => {
      registerCommand(cmd);
      unsubscribers.push(() => unregisterCommand(cmd.id));
    },
    registerMarkdownPostProcessor: (fn) => {
      postProcessors.push(fn);
      unsubscribers.push(() => {
        const idx = postProcessors.indexOf(fn);
        if (idx >= 0) postProcessors.splice(idx, 1);
      });
    },
    on: (event, handler) => {
      let set = eventSubscribers.get(event);
      if (!set) {
        set = new Set();
        eventSubscribers.set(event, set);
      }
      set.add(handler);
      return () => set!.delete(handler);
    },
    readFile: async (fileId) => {
      const state = useVaultStore.getState();
      return state.contentCache[fileId] ?? null;
    },
    writeFile: async (fileId, content) => {
      useVaultStore.getState().setContent(fileId, content, true);
    },
    getActiveFile: () => {
      const state = useVaultStore.getState();
      const ws = state.workspace;
      if (!ws || !ws.activeLeafId) return null;
      const leaf = findLeafById(ws.root, ws.activeLeafId);
      if (!leaf || leaf.view.kind !== "editor") return null;
      return leaf.view.activeTabId;
    },
  };

  onload(api);

  const plugin: LoadedPlugin = {
    manifest,
    api,
    cleanup: () => {
      unsubscribers.forEach((fn) => fn());
    },
  };
  loadedPlugins.set(manifest.id, plugin);
  return plugin;
}

/** Unload a plugin. */
export function unloadPlugin(id: string): void {
  const plugin = loadedPlugins.get(id);
  if (!plugin) return;
  plugin.cleanup();
  loadedPlugins.delete(id);
}

/** Emit an event to all subscribers. */
export function emitEvent(type: PluginEvent, payload: EventPayload): void {
  const set = eventSubscribers.get(type);
  if (!set) return;
  for (const handler of set) handler({ ...payload, type });
}

/** Run all registered post-processors on a DOM container. */
export function runPostProcessors(
  container: HTMLElement,
  context: PostProcessorContext
): void {
  for (const fn of postProcessors) {
    try {
      fn(container, context);
    } catch (err) {
      console.error(`Post-processor error:`, err);
    }
  }
}

/** Get all loaded plugins. */
export function getLoadedPlugins(): LoadedPlugin[] {
  return [...loadedPlugins.values()];
}

// --- helper ---------------------------------------------------------------

function findLeafById(node: WorkspaceNode, id: string): LeafNode | null {
  if (node.id === id) return node.type === "leaf" ? node : null;
  if (node.type !== "branch") return null;
  for (const c of node.children) {
    const r = findLeafById(c, id);
    if (r) return r;
  }
  return null;
}
