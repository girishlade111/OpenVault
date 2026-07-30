"use client";

import { Minus, Square, X } from "lucide-react";

/**
 * Custom window controls (minimize, maximize, close) for frameless Electron
 * windows on Windows/Linux. These replace the native buttons removed by
 * frame: false.
 *
 * Uses window.require('electron') since nodeIntegration is enabled and
 * contextIsolation is disabled in main.js.
 */

function getIpcRenderer() {
  try {
    const electron = (window as any).require("electron");
    return electron.ipcRenderer;
  } catch {
    return null;
  }
}

export function WindowControls() {
  const handleMinimize = () => {
    getIpcRenderer()?.send("window-minimize");
  };

  const handleMaximize = () => {
    getIpcRenderer()?.send("window-maximize");
  };

  const handleClose = () => {
    getIpcRenderer()?.send("window-close");
  };

  return (
    <div
      className="flex items-center ml-auto gap-0"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        onClick={handleMinimize}
        className="w-11 h-8 flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        aria-label="Minimize"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleMaximize}
        className="w-11 h-8 flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        aria-label="Maximize"
      >
        <Square className="h-3 w-3" />
      </button>
      <button
        onClick={handleClose}
        className="w-11 h-8 flex items-center justify-center text-muted-foreground hover:bg-red-600 hover:text-white transition-colors"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
