import assert from "node:assert/strict";
import test from "node:test";
import { completeWikiLink, editorSource, parseInline, persistedSource, splitMdBlocks, unescapeLeadingDash } from "./text.ts";

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

test("complete_wiki_link_preserves_suffix_and_caret", () => {
  const result = completeWikiLink("текст [[ча и дальше", "Часть", "ча");
  assert.deepEqual(result, { text: "текст [[Часть]] и дальше", caret: 15 });
});

test("complete_wiki_link_preserves_following_lines", () => {
  const result = completeWikiLink("[[\nвторая строка", "Страница", "");
  assert.deepEqual(result, { text: "[[Страница]]\nвторая строка", caret: 12 });
});

test("inline_code_keeps_links_tags_urls_literal", () => {
  const result = parseInline("`[[A]] #tag https://example.com`");
  assert.deepEqual(result, [{ type: "code", text: "[[A]] #tag https://example.com", start: 0, end: 32 }]);
});

test("variable_backticks_and_fenced_code_are_literal", () => {
  const inline = parseInline("`` [[A]] ``");
  assert.equal(inline[0].type, "code");
  const blocks = splitMdBlocks("```md\n[[A]] #tag\n```");
  assert.deepEqual(blocks, [{ kind: "code", text: "[[A]] #tag", lang: "md" }]);
});
