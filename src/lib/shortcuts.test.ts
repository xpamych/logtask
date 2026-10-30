import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCommandContext,
  commandForContext,
  effectiveShortcuts,
  formatShortcut,
  isProtectedShortcut,
  isValidShortcut,
  normalizeShortcut,
  resetShortcutOverride,
  shortcutConflict,
  shouldHandleGlobalShortcut,
} from "./shortcuts.ts";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test("нормализация использует физическую клавишу и платформенный mod", () => {
  assert.equal(normalizeShortcut(key("KeyK", { ctrlKey: true }), false), "mod+k");
  assert.equal(normalizeShortcut(key("KeyK", { metaKey: true }), true), "mod+k");
  assert.equal(normalizeShortcut(key("KeyK"), false), "k");
  assert.equal(normalizeShortcut(key("Digit1", { shiftKey: true }), false), "shift+1");
  assert.equal(normalizeShortcut(key("F1"), false), "f1");
  assert.equal(normalizeShortcut(key("Escape"), false), null);
  assert.equal(normalizeShortcut(key("ControlLeft", { ctrlKey: true }), false), null);
});

test("системные сочетания защищены", () => {
  for (const shortcut of ["mod+c", "mod+v", "mod+x", "mod+a", "mod+z", "mod+y"]) {
    assert.equal(isProtectedShortcut(shortcut), true, shortcut);
  }
  assert.equal(isProtectedShortcut("mod+k"), false);
  assert.equal(isProtectedShortcut("j"), false);
});

test("эффективная схема игнорирует неизвестные id и поддерживает отключение", () => {
  const effective = effectiveShortcuts({ palette: "mod+shift+p", search: null, future: "x" });
  assert.equal(effective.palette, "mod+shift+p");
  assert.equal(effective.search, null);
  assert.equal("future" in effective, false);
  assert.equal(effective.today, "mod+j");
});

test("конфликт учитывает только один контекст", () => {
  const effective = effectiveShortcuts({});
  assert.equal(shortcutConflict("search", "mod+p", effective), "quickPage");
  assert.equal(shortcutConflict("taskEdit", "e", effective), null);
});

test("глобальные сочетания не мешают вводу и редактированию", () => {
  const body = { tagName: "BODY", isContentEditable: false } as unknown as EventTarget;
  const textarea = { tagName: "TEXTAREA", isContentEditable: false } as unknown as EventTarget;
  const editable = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
  assert.equal(shouldHandleGlobalShortcut(body, "mod+k"), true);
  assert.equal(shouldHandleGlobalShortcut(textarea, "mod+k"), true);
  assert.equal(shouldHandleGlobalShortcut(textarea, "j"), false);
  assert.equal(shouldHandleGlobalShortcut(editable, "j"), false);
  assert.equal(shouldHandleGlobalShortcut(body, "mod+c"), false);
});

test("меню задачи имеет приоритет над списком, но не разрешает буквы при вводе", () => {
  assert.equal(activeCommandContext(true, false), "taskMenu");
  assert.equal(activeCommandContext(false, false), "taskList");
  assert.equal(activeCommandContext(true, true), "taskMenu");
  assert.equal(shouldHandleGlobalShortcut({ tagName: "TEXTAREA" } as unknown as EventTarget, "1"), false);
  assert.equal(shouldHandleGlobalShortcut({ tagName: "TEXTAREA" } as unknown as EventTarget, "mod+k"), true);
});

test("форматирование и сброс пользовательских сочетаний", () => {
  assert.equal(formatShortcut("mod+shift+k", false), "Ctrl+Shift+K");
  assert.equal(formatShortcut("mod+shift+k", true), "Cmd+Shift+K");
  assert.equal(formatShortcut("j", false), "J");
  assert.equal(formatShortcut(null, false), "Не назначено");
  const overrides = { palette: "mod+shift+p", search: null };
  assert.deepEqual(resetShortcutOverride(overrides, "palette"), { search: null });
  assert.deepEqual(resetShortcutOverride(overrides, "missing"), overrides);
});

test("команда выбирается только в активном контексте", () => {
  const effective = effectiveShortcuts({});
  assert.equal(commandForContext("e", effective, "taskMenu"), "importanceHigh");
  assert.equal(commandForContext("e", effective, "taskList"), "taskEdit");
  assert.equal(commandForContext("mod+k", effective, "global"), "palette");
  assert.equal(commandForContext("mod+k", effective, "taskList"), null);
});

test("повреждённые и опасные сочетания отклоняются", () => {
  assert.equal(isValidShortcut("mod+shift+k"), true);
  assert.equal(isValidShortcut("not a shortcut"), false);
  assert.equal(isValidShortcut("mod+unknown"), false);
  assert.equal(effectiveShortcuts({ palette: "not a shortcut" }).palette, "mod+k");
  for (const shortcut of ["mod+shift+z", "mod+q", "mod+enter", "alt+f4"]) {
    assert.equal(isProtectedShortcut(shortcut), true, shortcut);
  }
  assert.equal(normalizeShortcut(key("KeyK", { metaKey: true }), false), null);
  assert.equal(normalizeShortcut(key("KeyK", { ctrlKey: true }), true), null);
});
