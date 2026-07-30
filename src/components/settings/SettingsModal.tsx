"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThemeStore } from "@/lib/theme/theme-store";
import {
  useSettingsStore,
  type AccentColor,
  type IndentSize,
  type LineWidth,
  type DeletedFilesBehavior,
} from "@/lib/settings/settings-store";
import { getAllCommands, getHotkey, setHotkeyOverride } from "@/lib/automation/hotkeys";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Settings,
  Type,
  FolderOpen,
  Palette,
  Keyboard,
} from "lucide-react";

type Section = "editor" | "files" | "appearance" | "hotkeys";

const SECTIONS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "editor", label: "Editor", icon: Type },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
];

const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "purple", label: "Purple", hex: "#8b5cf6" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "orange", label: "Orange", hex: "#f97316" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
];

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<Section>("editor");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] h-[520px] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 min-h-0">
          {/* Sidebar navigation */}
          <nav className="w-44 border-r py-2 shrink-0 overflow-y-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={cn(
                  "flex items-center gap-2 w-full px-4 py-2 text-sm text-left transition-colors",
                  section === s.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
                onClick={() => setSection(s.id)}
              >
                <s.icon className="w-4 h-4" />
                {s.label}
              </button>
            ))}
          </nav>
          {/* Content area */}
          <div className="flex-1 p-6 overflow-y-auto">
            {section === "editor" && <EditorSection />}
            {section === "files" && <FilesSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "hotkeys" && <HotkeysSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditorSection() {
  const editor = useSettingsStore((s) => s.editor);
  const setSetting = useSettingsStore((s) => s.setEditorSetting);

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-foreground">Editor</h3>

      <div className="grid gap-4">
        {/* Font size */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Font size</Label>
            <p className="text-xs text-muted-foreground">Size in pixels</p>
          </div>
          <Input
            type="number"
            min={10}
            max={24}
            value={editor.fontSize}
            onChange={(e) => setSetting("fontSize", parseInt(e.target.value) || 14)}
            className="w-20 h-8"
          />
        </div>

        {/* Show line numbers */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Show line numbers</Label>
            <p className="text-xs text-muted-foreground">Display line numbers in the gutter</p>
          </div>
          <button
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              editor.showLineNumbers ? "bg-primary" : "bg-muted"
            )}
            onClick={() => setSetting("showLineNumbers", !editor.showLineNumbers)}
            role="switch"
            aria-checked={editor.showLineNumbers}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                editor.showLineNumbers ? "translate-x-[18px]" : "translate-x-[2px]"
              )}
            />
          </button>
        </div>

        {/* Line width */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Readable line length</Label>
            <p className="text-xs text-muted-foreground">Content width constraint</p>
          </div>
          <Select
            value={editor.lineWidth}
            onValueChange={(val) => setSetting("lineWidth", val as LineWidth)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="narrow">Narrow</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="wide">Wide</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Indent size */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Indent size</Label>
            <p className="text-xs text-muted-foreground">Number of spaces per indent</p>
          </div>
          <Select
            value={String(editor.indentSize)}
            onValueChange={(val) => setSetting("indentSize", parseInt(val) as IndentSize)}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Spell check */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Spell check</Label>
            <p className="text-xs text-muted-foreground">Enable browser spell checking</p>
          </div>
          <button
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              editor.spellCheck ? "bg-primary" : "bg-muted"
            )}
            onClick={() => setSetting("spellCheck", !editor.spellCheck)}
            role="switch"
            aria-checked={editor.spellCheck}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                editor.spellCheck ? "translate-x-[18px]" : "translate-x-[2px]"
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function FilesSection() {
  const files = useSettingsStore((s) => s.files);
  const setSetting = useSettingsStore((s) => s.setFilesSetting);

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-foreground">Files & Links</h3>

      <div className="grid gap-4">
        {/* Default new note location */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Default location for new notes</Label>
            <p className="text-xs text-muted-foreground">Where new notes are created</p>
          </div>
          <Select
            value={files.defaultNewNoteLocation}
            onValueChange={(val) =>
              setSetting("defaultNewNoteLocation", val as "root" | "current")
            }
          >
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="root">Vault root</SelectItem>
              <SelectItem value="current">Current folder</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Attachment folder */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Attachment folder</Label>
            <p className="text-xs text-muted-foreground">Folder for storing attachments</p>
          </div>
          <Input
            value={files.attachmentFolder}
            onChange={(e) => setSetting("attachmentFolder", e.target.value)}
            className="w-36 h-8"
          />
        </div>

        {/* Deleted files behavior */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Deleted files</Label>
            <p className="text-xs text-muted-foreground">What happens when you delete a file</p>
          </div>
          <Select
            value={files.deletedFilesBehavior}
            onValueChange={(val) =>
              setSetting("deletedFilesBehavior", val as DeletedFilesBehavior)
            }
          >
            <SelectTrigger className="w-36 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trash">Move to trash</SelectItem>
              <SelectItem value="permanent">Delete permanently</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const accentColor = useSettingsStore((s) => s.appearance.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-foreground">Appearance</h3>

      <div className="grid gap-4">
        {/* Theme */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Theme</Label>
            <p className="text-xs text-muted-foreground">Light, dark, or system</p>
          </div>
          <Select value={mode} onValueChange={(val) => setMode(val as "light" | "dark" | "system")}>
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Accent color */}
        <div>
          <Label className="text-sm">Accent color</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Choose the primary accent color
          </p>
          <div className="flex gap-2">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color.id}
                className={cn(
                  "w-8 h-8 rounded-full border-2 transition-all",
                  accentColor === color.id
                    ? "border-foreground scale-110"
                    : "border-transparent hover:scale-105"
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => setAccentColor(color.id)}
                aria-label={color.label}
                title={color.label}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HotkeysSection() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listeningKeys, setListeningKeys] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);
  const storeSetOverride = useSettingsStore((s) => s.setHotkeyOverride);

  // Compute commands outside of useEffect to avoid setState-in-effect lint error
  const commands = getAllCommands().map((cmd) => ({
    id: cmd.id,
    name: cmd.name,
    category: cmd.category,
    hotkey: getHotkey(cmd.id),
  }));

  const handleKeyCapture = useCallback(
    (e: KeyboardEvent) => {
      if (!editingId) return;
      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier-only key presses
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.metaKey || e.ctrlKey) parts.push("Mod");
      if (e.shiftKey) parts.push("Shift");
      if (e.altKey) parts.push("Alt");

      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();
      else key = key.charAt(0).toUpperCase() + key.slice(1);

      parts.push(key);
      const hotkey = parts.join("+");
      setListeningKeys(hotkey);

      // Apply the override
      setHotkeyOverride(editingId, hotkey);
      storeSetOverride(editingId, hotkey);

      // Force a refresh to pick up new hotkey
      setRefreshKey((k) => k + 1);

      setEditingId(null);
      setListeningKeys("");
    },
    [editingId, storeSetOverride]
  );

  useEffect(() => {
    if (editingId) {
      window.addEventListener("keydown", handleKeyCapture, true);
      return () => window.removeEventListener("keydown", handleKeyCapture, true);
    }
  }, [editingId, handleKeyCapture]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">Hotkeys</h3>
      <p className="text-xs text-muted-foreground">
        Click on a hotkey to rebind it. Press Escape to cancel.
      </p>

      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block">{cmd.name}</span>
              {cmd.category && (
                <span className="text-xs text-muted-foreground">{cmd.category}</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs min-w-[80px] font-mono",
                editingId === cmd.id && "ring-2 ring-primary"
              )}
              onClick={() => {
                if (editingId === cmd.id) {
                  setEditingId(null);
                  setListeningKeys("");
                } else {
                  setEditingId(cmd.id);
                  setListeningKeys("");
                }
              }}
            >
              {editingId === cmd.id
                ? listeningKeys || "Press keys..."
                : cmd.hotkey ?? "None"}
            </Button>
          </div>
        ))}
        {commands.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No commands registered yet
          </p>
        )}
      </div>
    </div>
  );
}
