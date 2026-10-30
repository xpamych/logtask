import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveShortcuts,
  isProtectedShortcut,
  normalizeShortcut,
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
