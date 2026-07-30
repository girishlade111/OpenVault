"use client";

import { create } from "zustand";
import type { FileId } from "@/lib/vault/types";

// --- Settings Types --------------------------------------------------------

export type IndentSize = 2 | 4;
export type LineWidth = "narrow" | "medium" | "wide";
export type DeletedFilesBehavior = "trash" | "permanent";
export type AccentColor = "blue" | "purple" | "red" | "green" | "orange" | "pink";

export interface EditorSettings {
  fontSize: number;
  showLineNumbers: boolean;
  lineWidth: LineWidth;
  indentSize: IndentSize;
  spellCheck: boolean;
  readableLineLength: boolean;
}

export interface FilesSettings {
  defaultNewNoteLocation: "root" | "current";
  attachmentFolder: string;
  deletedFilesBehavior: DeletedFilesBehavior;
}

export interface AppearanceSettings {
  accentColor: AccentColor;
}

export interface HotkeyOverride {
  commandId: string;
  hotkey: string | null;
}

export interface SettingsState {
  editor: EditorSettings;
  files: FilesSettings;
  appearance: AppearanceSettings;
  hotkeyOverrides: HotkeyOverride[];
  starredNotes: FileId[];

  // Actions
  setEditorSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  setFilesSetting: <K extends keyof FilesSettings>(key: K, value: FilesSettings[K]) => void;
  setAccentColor: (color: AccentColor) => void;
  setHotkeyOverride: (commandId: string, hotkey: string | null) => void;
  removeHotkeyOverride: (commandId: string) => void;
  toggleStarredNote: (fileId: FileId) => void;
  isStarred: (fileId: FileId) => boolean;
}

const LS_KEY = "vault:settings";

const ACCENT_COLORS: Record<AccentColor, string> = {
  blue: "217 91% 60%",
  purple: "263 70% 50%",
  red: "0 72% 51%",
  green: "142 71% 45%",
  orange: "25 95% 53%",
  pink: "330 81% 60%",
};

function applyAccentColor(color: AccentColor) {
  if (typeof document === "undefined") return;
  const hsl = ACCENT_COLORS[color];
  document.documentElement.style.setProperty("--primary", hsl);
}

function loadFromLocalStorage(): Partial<SettingsState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToLocalStorage(state: SettingsState) {
  if (typeof window === "undefined") return;
  try {
    const serializable = {
      editor: state.editor,
      files: state.files,
      appearance: state.appearance,
      hotkeyOverrides: state.hotkeyOverrides,
      starredNotes: state.starredNotes,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(serializable));
  } catch {
    // ignore
  }
}

const defaultEditor: EditorSettings = {
  fontSize: 14,
  showLineNumbers: true,
  lineWidth: "medium",
  indentSize: 2,
  spellCheck: false,
  readableLineLength: true,
};

const defaultFiles: FilesSettings = {
  defaultNewNoteLocation: "root",
  attachmentFolder: "attachments",
  deletedFilesBehavior: "trash",
};

const defaultAppearance: AppearanceSettings = {
  accentColor: "blue",
};

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Load persisted state
  const persisted = loadFromLocalStorage();

  const initialEditor = persisted?.editor
    ? { ...defaultEditor, ...(persisted.editor as Partial<EditorSettings>) }
    : defaultEditor;
  const initialFiles = persisted?.files
    ? { ...defaultFiles, ...(persisted.files as Partial<FilesSettings>) }
    : defaultFiles;
  const initialAppearance = persisted?.appearance
    ? { ...defaultAppearance, ...(persisted.appearance as Partial<AppearanceSettings>) }
    : defaultAppearance;
  const initialOverrides = (persisted?.hotkeyOverrides as HotkeyOverride[] | undefined) ?? [];
  const initialStarred = (persisted?.starredNotes as FileId[] | undefined) ?? [];

  // Apply accent color on load
  if (typeof window !== "undefined") {
    setTimeout(() => applyAccentColor(initialAppearance.accentColor), 0);
  }

  return {
    editor: initialEditor,
    files: initialFiles,
    appearance: initialAppearance,
    hotkeyOverrides: initialOverrides,
    starredNotes: initialStarred,

    setEditorSetting: (key, value) => {
      const next = { ...get().editor, [key]: value };
      set({ editor: next });
      saveToLocalStorage(get());
    },

    setFilesSetting: (key, value) => {
      const next = { ...get().files, [key]: value };
      set({ files: next });
      saveToLocalStorage(get());
    },

    setAccentColor: (color) => {
      applyAccentColor(color);
      set({ appearance: { ...get().appearance, accentColor: color } });
      saveToLocalStorage(get());
    },

    setHotkeyOverride: (commandId, hotkey) => {
      const overrides = get().hotkeyOverrides.filter((o) => o.commandId !== commandId);
      overrides.push({ commandId, hotkey });
      set({ hotkeyOverrides: overrides });
      saveToLocalStorage(get());
    },

    removeHotkeyOverride: (commandId) => {
      const overrides = get().hotkeyOverrides.filter((o) => o.commandId !== commandId);
      set({ hotkeyOverrides: overrides });
      saveToLocalStorage(get());
    },

    toggleStarredNote: (fileId) => {
      const starred = get().starredNotes;
      const next = starred.includes(fileId)
        ? starred.filter((id) => id !== fileId)
        : [...starred, fileId];
      set({ starredNotes: next });
      saveToLocalStorage(get());
    },

    isStarred: (fileId) => {
      return get().starredNotes.includes(fileId);
    },
  };
});
