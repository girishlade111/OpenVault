"use client";

import { useEffect, useRef } from "react";
import { useVaultStore } from "@/store/vault-store";
import { useEditorModeStore } from "@/store/editor-mode-store";
import { useSettingsStore } from "@/lib/settings/settings-store";
import { findLeaf } from "@/lib/workspace/tree";
import type { WorkspaceNode, LeafNode } from "@/lib/workspace/types";
import { getActiveEditorRef } from "@/store/editor-ref-store";
import {
  registerCommand,
  unregisterCommand,
} from "@/lib/automation/hotkeys";
import {
  getDailyNotePath,
  renderDailyNote,
  DEFAULT_DAILY_CONFIG,
} from "@/lib/automation/daily-notes";

/** Helper to find a leaf for command execution (avoids circular deps). */
function findLeafForCommand(root: WorkspaceNode, id: string): LeafNode | null {
  return findLeaf(root, id);
}

/**
 * Registers built-in commands on mount and cleans up on unmount.
 * Mounted once at the top of VaultApp.
 */
export function useBuiltinCommands(
  onTogglePalette: () => void,
  onToggleQuickSwitcher?: () => void
) {
  const registeredRef = useRef(false);
  const onTogglePaletteRef = useRef(onTogglePalette);
  const onToggleQuickSwitcherRef = useRef(onToggleQuickSwitcher);

  useEffect(() => {
    onTogglePaletteRef.current = onTogglePalette;
    onToggleQuickSwitcherRef.current = onToggleQuickSwitcher;
  });

  useEffect(() => {
    // =========================================================================
    // APP COMMANDS
    // =========================================================================

    registerCommand({
      id: "app.command-palette",
      name: "Open command palette",
      category: "App",
      hotkey: "Mod+P",
      run: () => onTogglePaletteRef.current(),
    });

    registerCommand({
      id: "app.quick-switcher",
      name: "Quick switcher: Open file",
      category: "App",
      hotkey: "Mod+O",
      run: () => onToggleQuickSwitcherRef.current?.(),
    });

    registerCommand({
      id: "app.toggle-left-sidebar",
      name: "Toggle file tree",
      category: "View",
      hotkey: "Mod+\\",
      run: () => useVaultStore.getState().toggleLeftSidebar(),
    });

    registerCommand({
      id: "app.toggle-right-sidebar",
      name: "Toggle inspector",
      category: "View",
      hotkey: "Mod+Shift+\\",
      run: () => useVaultStore.getState().toggleRightSidebar(),
    });

    registerCommand({
      id: "app.open-graph",
      name: "Open graph view",
      category: "View",
      run: () => useVaultStore.getState().openGraphView(),
    });

    registerCommand({
      id: "app.split-right",
      name: "Split right",
      category: "View",
      run: () => useVaultStore.getState().splitActiveLeaf("horizontal"),
    });

    registerCommand({
      id: "app.split-down",
      name: "Split down",
      category: "View",
      run: () => useVaultStore.getState().splitActiveLeaf("vertical"),
    });

    registerCommand({
      id: "app.new-note",
      name: "Create new note",
      category: "File",
      hotkey: "Mod+N",
      run: () => {
        const state = useVaultStore.getState();
        const manifest = state.manifest;
        if (!manifest) return;
        let name = "Untitled.md";
        let counter = 1;
        while (manifest.pathIndex[name]) {
          name = `Untitled ${counter}.md`;
          counter++;
        }
        const newId = state.createFile(manifest.rootId, name);
        if (newId) state.openFile(newId);
      },
    });

    registerCommand({
      id: "app.star-note",
      name: "Star/unstar current note",
      category: "File",
      hotkey: "Mod+Shift+S",
      run: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return;
        const root = ws.root;
        const leaf = findLeafForCommand(root, ws.activeLeafId);
        if (!leaf || leaf.view.kind !== "editor" || !leaf.view.activeTabId) return;
        useSettingsStore.getState().toggleStarredNote(leaf.view.activeTabId);
      },
      available: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return false;
        return true;
      },
    });

    // =========================================================================
    // NAVIGATION COMMANDS
    // =========================================================================

    registerCommand({
      id: "app.navigate-back",
      name: "Navigate back",
      category: "Navigation",
      hotkey: "Alt+ArrowLeft",
      run: () => useVaultStore.getState().navigateBack(),
    });

    registerCommand({
      id: "app.navigate-forward",
      name: "Navigate forward",
      category: "Navigation",
      hotkey: "Alt+ArrowRight",
      run: () => useVaultStore.getState().navigateForward(),
    });

    // =========================================================================
    // EDITOR MODE COMMANDS
    // =========================================================================

    registerCommand({
      id: "editor.toggle-mode",
      name: "Toggle edit/reading mode",
      category: "Editor",
      hotkey: "Mod+E",
      run: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return;
        useEditorModeStore.getState().toggleMode(ws.activeLeafId);
      },
    });

    registerCommand({
      id: "editor.cycle-mode",
      name: "Cycle editor mode",
      category: "Editor",
      hotkey: "Mod+Shift+E",
      run: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return;
        useEditorModeStore.getState().cycleMode(ws.activeLeafId);
      },
    });

    // =========================================================================
    // FORMATTING COMMANDS
    // =========================================================================

    registerCommand({
      id: "editor.toggle-bold",
      name: "Toggle bold",
      category: "Editor",
      hotkey: "Mod+B",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("**", "**");
      },
    });

    registerCommand({
      id: "editor.toggle-italic",
      name: "Toggle italic",
      category: "Editor",
      hotkey: "Mod+I",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("*", "*");
      },
    });

    registerCommand({
      id: "editor.toggle-strikethrough",
      name: "Toggle strikethrough",
      category: "Editor",
      hotkey: "Mod+Shift+X",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("~~", "~~");
      },
    });

    registerCommand({
      id: "editor.toggle-code",
      name: "Toggle inline code",
      category: "Editor",
      hotkey: "Mod+`",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("`", "`");
      },
    });

    registerCommand({
      id: "editor.toggle-highlight",
      name: "Toggle highlight",
      category: "Editor",
      hotkey: "Mod+Shift+H",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("==", "==");
      },
    });

    registerCommand({
      id: "editor.insert-link",
      name: "Insert markdown link",
      category: "Editor",
      hotkey: "Mod+K",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("[", "](url)");
      },
    });

    registerCommand({
      id: "editor.insert-wikilink",
      name: "Insert wikilink",
      category: "Editor",
      hotkey: "Mod+Shift+K",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.wrapSelection("[[", "]]");
      },
    });

    // =========================================================================
    // FOLD COMMANDS
    // =========================================================================

    registerCommand({
      id: "editor.fold",
      name: "Fold current block",
      category: "Editor",
      hotkey: "Mod+Shift+[",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.foldAtCursor();
      },
    });

    registerCommand({
      id: "editor.unfold",
      name: "Unfold current block",
      category: "Editor",
      hotkey: "Mod+Shift+]",
      run: () => {
        const editor = getActiveEditorRef();
        if (editor) editor.unfoldAtCursor();
      },
    });

    // =========================================================================
    // DAILY NOTES COMMAND
    // =========================================================================

    registerCommand({
      id: "app.open-daily-note",
      name: "Open today's daily note",
      category: "Daily",
      run: () => {
        const state = useVaultStore.getState();
        const manifest = state.manifest;
        if (!manifest) return;

        const dailyPath = getDailyNotePath(DEFAULT_DAILY_CONFIG);
        const existingId = manifest.pathIndex[dailyPath];

        if (existingId) {
          // Already exists, just open it
          state.openFile(existingId);
        } else {
          // Create the daily note
          // Ensure the Daily folder exists
          const folderPath = DEFAULT_DAILY_CONFIG.folder;
          let folderId = manifest.pathIndex[folderPath];
          if (!folderId) {
            folderId = state.createFolder(manifest.rootId, folderPath);
            if (!folderId) return;
          }
          // Create the file
          const filename = dailyPath.split("/").pop() ?? dailyPath;
          const newId = state.createFile(folderId, filename);
          if (!newId) return;
          // Set the content
          const content = renderDailyNote(DEFAULT_DAILY_CONFIG);
          state.setContent(newId, content, false);
          // Open it
          state.openFile(newId);
        }
      },
    });

    // =========================================================================
    // PANE/TAB COMMANDS
    // =========================================================================

    registerCommand({
      id: "app.open-in-new-pane",
      name: "Open current file in new pane",
      category: "View",
      run: () => {
        const state = useVaultStore.getState();
        const ws = state.workspace;
        if (!ws?.activeLeafId) return;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        if (!leaf || leaf.view.kind !== "editor" || !leaf.view.activeTabId) return;
        const fileId = leaf.view.activeTabId;
        // Split first, then open the file in the new leaf
        state.splitActiveLeaf("horizontal");
        // After split, the new leaf becomes active
        const newWs = useVaultStore.getState().workspace;
        if (newWs?.activeLeafId && newWs.activeLeafId !== ws.activeLeafId) {
          state.openFileInLeaf(newWs.activeLeafId, fileId);
        }
      },
      available: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return false;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        return !!leaf && leaf.view.kind === "editor" && !!leaf.view.activeTabId;
      },
    });

    registerCommand({
      id: "app.close-other-tabs",
      name: "Close all other tabs",
      category: "View",
      run: () => {
        const state = useVaultStore.getState();
        const ws = state.workspace;
        if (!ws?.activeLeafId) return;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        if (!leaf || leaf.view.kind !== "editor" || !leaf.view.activeTabId) return;
        const activeTab = leaf.view.activeTabId;
        const otherTabs = leaf.view.tabs.filter((t) => t.fileId !== activeTab);
        for (const tab of otherTabs) {
          state.closeTab(ws.activeLeafId, tab.fileId);
        }
      },
      available: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return false;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        return !!leaf && leaf.view.kind === "editor" && leaf.view.tabs.length > 1;
      },
    });

    registerCommand({
      id: "app.close-tabs-to-right",
      name: "Close tabs to the right",
      category: "View",
      run: () => {
        const state = useVaultStore.getState();
        const ws = state.workspace;
        if (!ws?.activeLeafId) return;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        if (!leaf || leaf.view.kind !== "editor" || !leaf.view.activeTabId) return;
        const activeIdx = leaf.view.tabs.findIndex((t) => t.fileId === leaf.view.activeTabId);
        if (activeIdx < 0) return;
        const tabsToClose = leaf.view.tabs.slice(activeIdx + 1);
        for (const tab of tabsToClose) {
          state.closeTab(ws.activeLeafId, tab.fileId);
        }
      },
      available: () => {
        const ws = useVaultStore.getState().workspace;
        if (!ws?.activeLeafId) return false;
        const leaf = findLeafForCommand(ws.root, ws.activeLeafId);
        if (!leaf || leaf.view.kind !== "editor" || !leaf.view.activeTabId) return false;
        const activeIdx = leaf.view.tabs.findIndex((t) => t.fileId === leaf.view.activeTabId);
        return activeIdx < leaf.view.tabs.length - 1;
      },
    });

    registeredRef.current = true;

    return () => {
      unregisterCommand("app.command-palette");
      unregisterCommand("app.quick-switcher");
      unregisterCommand("app.toggle-left-sidebar");
      unregisterCommand("app.toggle-right-sidebar");
      unregisterCommand("app.open-graph");
      unregisterCommand("app.split-right");
      unregisterCommand("app.split-down");
      unregisterCommand("editor.toggle-mode");
      unregisterCommand("editor.cycle-mode");
      unregisterCommand("app.new-note");
      unregisterCommand("app.star-note");
      unregisterCommand("app.navigate-back");
      unregisterCommand("app.navigate-forward");
      unregisterCommand("editor.toggle-bold");
      unregisterCommand("editor.toggle-italic");
      unregisterCommand("editor.toggle-strikethrough");
      unregisterCommand("editor.toggle-code");
      unregisterCommand("editor.toggle-highlight");
      unregisterCommand("editor.insert-link");
      unregisterCommand("editor.insert-wikilink");
      unregisterCommand("editor.fold");
      unregisterCommand("editor.unfold");
      unregisterCommand("app.open-daily-note");
      unregisterCommand("app.open-in-new-pane");
      unregisterCommand("app.close-other-tabs");
      unregisterCommand("app.close-tabs-to-right");
    };
  }, []);
}
