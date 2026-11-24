import assert from "node:assert/strict";
import test from "node:test";
import { extendBlockSelection, pruneBlockSelection, selectBlock, selectedBlockUuids } from "./blockSelection.ts";

test("диапазон включает якорь и цель в обоих направлениях", () => {
  const selected = selectBlock(null, "page", "b");
  assert.deepEqual(selectedBlockUuids(extendBlockSelection(selected, ["a", "b", "c", "d"], "d"), ["a", "b", "c", "d"]), ["b", "c", "d"]);
  assert.deepEqual(selectedBlockUuids(extendBlockSelection(selected, ["a", "b", "c", "d"], "a"), ["a", "b", "c", "d"]), ["a", "b"]);
});

test("одиночный блок и отсутствующая цель сохраняют предсказуемый якорь", () => {
  const selected = selectBlock(null, "page", "a");
  assert.deepEqual(selectedBlockUuids(selected, ["a", "b"]), ["a"]);
  assert.equal(extendBlockSelection(selected, ["a", "b"], "missing"), selected);
});

test("обновление графа удаляет отсутствующие блоки и сбрасывает пустое выделение", () => {
  const selected = selectBlock(null, "page", "b");
  assert.deepEqual(pruneBlockSelection(selected, ["a", "b"]), selected);
  assert.equal(pruneBlockSelection(selected, ["a"]), null);
  assert.equal(pruneBlockSelection(null, []), null);
});
