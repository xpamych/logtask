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

test("блочное протягивание начинается только после порога движения", async () => {
  const { blockDragStarted } = await import("./blockSelection.ts");
  assert.equal(blockDragStarted({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(blockDragStarted({ x: 10, y: 10 }, { x: 18, y: 18 }), true);
});

test("при переходе к родителю выделяется всё его поддерево", async () => {
  const { subtreeSelectionRange } = await import("./blockSelection.ts");
  const blocks = [
    { uuid: "root", indent: 0 }, { uuid: "parent", indent: 1 },
    { uuid: "child", indent: 2 }, { uuid: "grandchild", indent: 3 },
    { uuid: "next", indent: 0 },
  ];
  assert.deepEqual(subtreeSelectionRange(blocks, "parent"), ["parent", "grandchild"]);
  assert.deepEqual(subtreeSelectionRange(blocks, "next"), ["next", "next"]);
});
