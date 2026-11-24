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
  assert.equal(classifyEditorKey(key("Enter", { isComposing: true }), context), null);
  assert.equal(classifyEditorKey(key("Enter", { keyCode: 229 }), context), null);
  assert.equal(classifyEditorKey(key("Escape"), context), "cancel");
  assert.equal(classifyEditorKey(key("ArrowUp", { shiftKey: true }), context), null);
});
