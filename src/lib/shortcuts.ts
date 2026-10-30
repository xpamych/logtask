import { COMMAND_DEFINITIONS } from "./commands.ts";

export type ShortcutEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Space: "space",
  Enter: "enter",
  ArrowDown: "arrowdown",
  ArrowUp: "arrowup",
  Backspace: "backspace",
};

function codeKey(code: string): string | null {
  if (code === "Escape" || /^(Control|Shift|Alt|Meta)/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();
  return CODE_KEYS[code] ?? null;
}

export function normalizeShortcut(e: ShortcutEvent, isMac: boolean): string | null {
  const key = codeKey(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

export function effectiveShortcuts(
  overrides: Record<string, string | null>,
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const command of COMMAND_DEFINITIONS) {
    result[command.id] = Object.hasOwn(overrides, command.id)
      ? overrides[command.id]
      : command.defaultShortcut;
  }
  return result;
}

export function shortcutConflict(
  id: string,
  shortcut: string,
  effective: Record<string, string | null>,
): string | null {
  const command = COMMAND_DEFINITIONS.find((item) => item.id === id);
  if (!command) return null;
  return (
    COMMAND_DEFINITIONS.find(
      (item) =>
        item.id !== id && item.context === command.context && effective[item.id] === shortcut,
    )?.id ?? null
  );
}

export function isProtectedShortcut(shortcut: string): boolean {
  return ["mod+c", "mod+v", "mod+x", "mod+a", "mod+z", "mod+y"].includes(shortcut);
}

export function activeCommandContext(menuOpen: boolean, _textEditing: boolean): "taskMenu" | "taskList" {
  return menuOpen ? "taskMenu" : "taskList";
}

export function shouldHandleGlobalShortcut(
  target: EventTarget | null,
  shortcut: string,
): boolean {
  if (isProtectedShortcut(shortcut)) return false;
  if (shortcut.startsWith("mod+")) return true;
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !element?.isContentEditable && !["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? "");
}
