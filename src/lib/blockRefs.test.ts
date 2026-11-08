import assert from "node:assert/strict";
import test from "node:test";
import { completeAutocomplete, findAutocompleteContext } from "./blockRefs.ts";
import { parseInline, renderSourceMap, splitMdBlocks } from "./text.ts";

const ID = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a812";
const OTHER = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a813";
const REF = `((${ID}))`;

test("block refs разбираются как отдельные сегменты", () => {
  const segments = parseInline(`до ${REF} между (( ${OTHER} )) после`);
  const refs = segments.filter((segment) => segment.type === "blockRef");
  assert.deepEqual(refs.map((segment) => segment.target), [ID, OTHER]);
  assert.equal(segments.at(-1)?.text, " после");
});

test("malformed refs остаются обычным текстом", () => {
  assert.equal(parseInline("((не uuid))").some((segment) => segment.type === "blockRef"), false);
  assert.equal(parseInline("((123))").some((segment) => segment.type === "blockRef"), false);
});

test("refs в inline и fenced code не разбираются", () => {
  assert.equal(parseInline(`\`${REF}\``)[0].type, "code");
  const blocks = splitMdBlocks(`\`\`\`md\n${REF}\n\`\`\``);
  assert.equal(blocks[0].kind, "code");
});

test("source map сохраняет смещения текста после block ref", () => {
  const input = `до ${REF} после`;
  const map = renderSourceMap(input);
  const suffix = " после";
  const visibleIndex = map.length - suffix.length - 1;
  assert.equal(input.slice(map[visibleIndex]), suffix);
});

test("autocomplete выбирает незакрытый маркер перед кареткой", () => {
  const text = `[[закрыто]] и ((рели`;
  const context = findAutocompleteContext(text, text.length);
  assert.deepEqual(context, { kind: "block", query: "рели", start: 14, end: 20 });
  assert.deepEqual(completeAutocomplete(text, context!, REF), {
    text: `[[закрыто]] и ${REF}`,
    caret: 14 + REF.length,
  });
});

test("autocomplete игнорирует закрытые refs, другие строки и код", () => {
  assert.equal(findAutocompleteContext(`${REF}`, REF.length), null);
  assert.equal(findAutocompleteContext("((one\n two", 10), null);
  assert.equal(findAutocompleteContext(`\`${REF}`, REF.length + 1), null);
  assert.equal(findAutocompleteContext("```\n((ref", 9), null);
});

test("autocomplete страницы сохраняет формат и суффикс", () => {
  const text = "до [[Лог по";
  const context = findAutocompleteContext(text, 8);
  assert.deepEqual(context, { kind: "page", query: "Лог", start: 3, end: 8 });
  assert.deepEqual(completeAutocomplete(text, context!, "[[Logtask]]"), {
    text: "до [[Logtask]] по",
    caret: 14,
  });
});
