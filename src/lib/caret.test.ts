import assert from "node:assert/strict";
import test from "node:test";
import { clickCaretPosition } from "./text.ts";

test("клик в конец видимого текста ставит курсор после скрытых служебных строк", () => {
  assert.equal(clickCaretPosition(12, 20, 20, 45), 45);
});

test("клик внутри видимого текста сохраняет сопоставленную позицию", () => {
  assert.equal(clickCaretPosition(12, 10, 20, 45), 12);
});
