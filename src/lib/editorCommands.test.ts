import assert from "node:assert/strict";
import test from "node:test";
import { classifyEditorKey } from "../components/editor/editorCommands.ts";

const context = { value: "one\ntwo", selectionStart: 0, selectionEnd: 0 };
const key = (value: string, extra: Partial<Parameters<typeof classifyEditorKey>[0]> = {}) => ({
  key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  isComposing: false, keyCode: 0, ...extra,
});

test("Enter, сохранение и мягкий перенос различаются", () => {
  assert.equal(classifyEditorKey(key("Enter"), context), "split");
  assert.equal(classifyEditorKey(key("Enter", { ctrlKey: true }), context), "save");
  assert.equal(classifyEditorKey(key("Enter", { shiftKey: true }), context), null);
});

test("outliner-команды учитывают позицию каретки", () => {
  assert.equal(classifyEditorKey(key("Tab"), context), "indent");
  assert.equal(classifyEditorKey(key("Tab", { shiftKey: true }), context), "outdent");
  assert.equal(classifyEditorKey(key("Backspace"), context), "mergeUp");
  assert.equal(classifyEditorKey(key("Backspace"), { ...context, selectionStart: 1 }), null);
  assert.equal(classifyEditorKey(key("Delete"), { ...context, selectionStart: 7, selectionEnd: 7 }), "mergeDown");
  assert.equal(classifyEditorKey(key("ArrowDown"), context), null);
  assert.equal(classifyEditorKey(key("ArrowUp"), context), "navigateUp");
  assert.equal(classifyEditorKey(key("ArrowDown"), { ...context, selectionStart: 7, selectionEnd: 7 }), "navigateDown");
});

test("Mod+A выделяет блоки, а IME не вызывает структурные команды", () => {
  assert.equal(classifyEditorKey(key("a", { ctrlKey: true }), context), "selectAllBlocks");
  assert.equal(classifyEditorKey(key("a", { metaKey: true }), context), "selectAllBlocks");
  assert.equal(classifyEditorKey(key("ф", { ctrlKey: true, code: "KeyA" }), context), "selectAllBlocks");
  assert.equal(classifyEditorKey(key("Enter", { isComposing: true }), context), null);
  assert.equal(classifyEditorKey(key("Enter", { keyCode: 229 }), context), null);
  assert.equal(classifyEditorKey(key("Escape"), context), "cancel");
  assert.equal(classifyEditorKey(key("ArrowUp", { shiftKey: true }), context), null);
});

test("split использует актуальный документ, включая ещё не сохранённый ввод", async () => {
  const { splitEditorSource } = await import("../components/editor/editorCommands.ts");
  assert.deepEqual(splitEditorSource("до ввода\nпосле ввода", 8, 8), { before: "до ввода", after: "\nпосле ввода" });
  assert.deepEqual(splitEditorSource("абв", 1, 2), { before: "а", after: "в" });
});

test("blur старого редактора не сохраняется во время split", async () => {
  const { canSaveBlock } = await import("../components/editor/editorCommands.ts");
  assert.equal(canSaveBlock({ saving: false, editing: true }), true);
  assert.equal(canSaveBlock({ saving: true, editing: false }), false);
  assert.equal(canSaveBlock({ saving: false, editing: false }), false);
});

test("повторный Mod+A переходит от текста к блоку без ограничения по времени", async () => {
  const { selectAllAction } = await import("../components/editor/editorCommands.ts");
  assert.equal(selectAllAction(0, 1000), "text");
  assert.equal(selectAllAction(1000, 1700), "block");
  assert.equal(selectAllAction(1000, 2500), "block");
});

test("форматирование оборачивает и разворачивает выделенный текст", async () => {
  const { toggleInlineMarkup } = await import("../components/editor/editorCommands.ts");
  assert.deepEqual(toggleInlineMarkup("абв", 0, 3, "**"), { text: "**абв**", start: 2, end: 5 });
  assert.deepEqual(toggleInlineMarkup("**абв**", 2, 5, "**"), { text: "абв", start: 0, end: 3 });
});

test("команды форматирования и undo не зависят от раскладки", async () => {
  const { classifyEditorKey } = await import("../components/editor/editorCommands.ts");
  const base = { value: "текст", selectionStart: 0, selectionEnd: 5 };
  const event = (code: string, shiftKey = false) => ({ key: "я", code, ctrlKey: true, metaKey: false, altKey: false, shiftKey, isComposing: false, keyCode: 0 });
  assert.equal(classifyEditorKey(event("KeyB"), base), "bold");
  assert.equal(classifyEditorKey(event("KeyI"), base), "italic");
  assert.equal(classifyEditorKey(event("KeyS", true), base), "strike");
  assert.equal(classifyEditorKey(event("KeyH", true), base), "highlight");
  assert.equal(classifyEditorKey(event("KeyZ"), base), "undo");
  assert.equal(classifyEditorKey(event("KeyZ", true), base), "redo");
});
