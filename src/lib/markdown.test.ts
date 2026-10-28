import assert from "node:assert/strict";
import test from "node:test";
import { editorSource, persistedSource, unescapeLeadingDash } from "./text.ts";

test("экранированный маркер отображается как обычный текст", () => {
  assert.equal(unescapeLeadingDash("\\- тест"), "- тест");
  assert.equal(unescapeLeadingDash("текст \\- без изменений"), "текст \\- без изменений");
});

test("редактор скрывает экранирование, а сохранение восстанавливает его", () => {
  const stored = "тест\n\\- тест\n  importance:: medium";
  const edited = "тест\n- тест\n  importance:: medium";
  assert.equal(editorSource(stored), edited);
  assert.equal(persistedSource(edited), stored);
  assert.equal(persistedSource("- первая строка остаётся текстом блока"), "- первая строка остаётся текстом блока");
});
