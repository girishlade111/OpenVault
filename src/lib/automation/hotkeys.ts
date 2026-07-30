/**
 * Hotkey engine + command registry.
 *
 * A "command" is a named action with an optional default hotkey. Commands are
 * registered at app boot and can be triggered by:
 *  - Keyboard shortcut (the hotkey binding)
 *  - Command palette (Cmd/Ctrl+P)
 *  - Programmatic call (`executeCommand(id)`)
 *
 * Hotkey format: a string like "Mod+P", "Mod+Shift+K", "Alt+1" where:
 *  - Mod = Cmd on macOS, Ctrl elsewhere
 *  - Modifiers: Shift, Alt, Mod
 *  - Key: a single character or a named key (Enter, Escape, etc.)
 *
 * The engine installs a single global `keydown` listener that checks the
 * pressed combo against the registered bindings.
 */

export interface Command {
  /** Unique id, e.g. "editor.insert-template". */
  id: string;
  /** Display name for the palette. */
  name: string;
  /** Optional category for grouping in the palette. */
  category?: string;
  /** Default hotkey binding, e.g. "Mod+P". */
  hotkey?: string;
  /** The action to execute. */
  run: () => void;
  /** Whether the command is currently available (for palette filtering). */
  available?: () => boolean;
}

type CommandMap = Map<string, Command>;

const commands: CommandMap = new Map();
const hotkeyIndex: Map<string, string> = new Map(); // hotkey → command id
const userBindings: Map<string, string | null> = new Map(); // command id → override (null = disabled)

let listenerInstalled = false;

/** Register a command. Overwrites existing with the same id. */
export function registerCommand(cmd: Command): void {
  commands.set(cmd.id, cmd);
  rebuildHotkeyIndex();
  if (!listenerInstalled) installListener();
}

/** Unregister a command by id. */
export function unregisterCommand(id: string): void {
  commands.delete(id);
  rebuildHotkeyIndex();
}

/** Get all registered commands. */
export function getAllCommands(): Command[] {
  return [...commands.values()];
}

/** Execute a command by id. Returns true if found + run. */
export function executeCommand(id: string): boolean {
  const cmd = commands.get(id);
  if (!cmd) return false;
  if (cmd.available && !cmd.available()) return false;
  cmd.run();
  return true;
}

/** Override a command's hotkey (or disable with null). */
export function setHotkeyOverride(commandId: string, hotkey: string | null): void {
  userBindings.set(commandId, hotkey);
  rebuildHotkeyIndex();
}

/** Get the effective hotkey for a command (user override or default). */
export function getHotkey(commandId: string): string | null {
  if (userBindings.has(commandId)) return userBindings.get(commandId) ?? null;
  return commands.get(commandId)?.hotkey ?? null;
}

// --- hotkey matching -------------------------------------------------------

function rebuildHotkeyIndex(): void {
  hotkeyIndex.clear();
  for (const cmd of commands.values()) {
    const hotkey = getHotkey(cmd.id);
    if (hotkey) {
      hotkeyIndex.set(normalizeHotkey(hotkey), cmd.id);
    }
  }
}

/** Normalize a hotkey string to a canonical form for matching. */
function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split("+").map((p) => p.trim());
  const mods: string[] = [];
  let key = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "cmd" || lower === "ctrl") {
      mods.push("mod");
    } else if (lower === "shift") {
      mods.push("shift");
    } else if (lower === "alt" || lower === "option") {
      mods.push("alt");
    } else {
      key = lower;
    }
  }
  mods.sort();
  return [...mods, key].join("+");
}

/** Match a keyboard event to a hotkey string. */
function eventToHotkey(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.metaKey || e.ctrlKey) mods.push("mod");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey) mods.push("alt");
  let key = e.key.toLowerCase();
  // Normalize special keys.
  if (key === " ") key = "space";
  if (key === "escape") key = "escape";
  if (key === "enter") key = "enter";
  mods.sort();
  return [...mods, key].join("+");
}

function installListener(): void {
  if (typeof window === "undefined") return;
  listenerInstalled = true;
  window.addEventListener("keydown", (e) => {
    const hotkey = eventToHotkey(e);
    const cmdId = hotkeyIndex.get(hotkey);
    if (!cmdId) return;
    const cmd = commands.get(cmdId);
    if (!cmd) return;
    if (cmd.available && !cmd.available()) return;
    // Don't intercept plain-key shortcuts when the user is typing in an
    // input/textarea/editor — only Mod-based combos work everywhere.
    const target = e.target as HTMLElement;
    const isTyping =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);
    const hasMod = e.metaKey || e.ctrlKey;
    if (isTyping && !hasMod) return;
    e.preventDefault();
    cmd.run();
  });
}
