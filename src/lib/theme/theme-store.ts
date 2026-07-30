"use client";

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  init: () => void;
}

const LS_KEY = "vault:theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  resolved: "light",

  setMode: (mode) => {
    const resolved = mode === "system" ? getSystemTheme() : mode;
    applyTheme(resolved);
    set({ mode, resolved });
    try {
      localStorage.setItem(LS_KEY, mode);
    } catch {
      // ignore
    }
  },

  toggle: () => {
    const cur = get().resolved;
    get().setMode(cur === "dark" ? "light" : "dark");
  },

  init: () => {
    let mode: ThemeMode = "system";
    try {
      const stored = localStorage.getItem(LS_KEY) as ThemeMode | null;
      if (stored) mode = stored;
    } catch {
      // ignore
    }
    const resolved = mode === "system" ? getSystemTheme() : mode;
    applyTheme(resolved);
    set({ mode, resolved });

    // Listen for system theme changes.
    if (typeof window !== "undefined" && mode === "system") {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        if (get().mode === "system") {
          const r = e.matches ? "dark" : "light";
          applyTheme(r);
          set({ resolved: r });
        }
      });
    }
  },
}));
