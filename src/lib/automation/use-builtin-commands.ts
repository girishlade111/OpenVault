"use client";

import { useEffect, useRef } from "react";
import { useVaultStore } from "@/store/vault-store";
import { useEditorModeStore } from "@/store/editor-mode-store";
import {
  registerCommand,
  unregisterCommand,
} from "@/lib/automation/hotkeys";

/**
 * Registers built-in commands on mount and cleans up on unmount.
 * Mounted once at the top of VaultApp.
 */
export function useBuiltinCommands(onTogglePalette: () => void) {
  const registeredRef = useRef(false);
  const onTogglePaletteRef = useRef(onTogglePalette);

  useEffect(() => {
    onTogglePaletteRef.current = onTogglePalette;
  });

  useEffect(() => {
    // Register once.
    registerCommand({
      id: "app.command-palette",
      name: "Open command palette",
      category: "App",
      hotkey: "Mod+P",
      run: () => onTogglePaletteRef.current(),
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

    registeredRef.current = true;

    return () => {
      unregisterCommand("app.command-palette");
      unregisterCommand("app.toggle-left-sidebar");
      unregisterCommand("app.toggle-right-sidebar");
      unregisterCommand("app.open-graph");
      unregisterCommand("app.split-right");
      unregisterCommand("app.split-down");
      unregisterCommand("editor.toggle-mode");
      unregisterCommand("editor.cycle-mode");
    };
  }, []);
}
