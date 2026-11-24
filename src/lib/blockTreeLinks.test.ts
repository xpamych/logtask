import assert from "node:assert/strict";
import test from "node:test";
import { blockParentUuids, treeLinkPath } from "./blockTreeLinks.ts";

test("родители вычисляются по стеку уровней", () => {
  assert.deepEqual(blockParentUuids([
    { uuid: "a", indent: 0 }, { uuid: "b", indent: 1 }, { uuid: "c", indent: 2 },
    { uuid: "d", indent: 1 }, { uuid: "e", indent: 0 },
  ]), { b: "a", c: "b", d: "a" });
});

test("линия идёт от нижней точки родителя к левой точке ребёнка с закруглением", () => {
  assert.equal(treeLinkPath(
    { x: 100, y: 100, radius: 5 }, { x: 130, y: 160, radius: 5 },
  ), "M100 105 V148 Q100 160 112 160 H125");
});

test("при наведении активны ребёнок и вся цепочка предков", async () => {
  const { treeActiveUuids } = await import("./blockTreeLinks.ts");
  const blocks = [
    { uuid: "a", indent: 0 }, { uuid: "b", indent: 1 },
    { uuid: "c", indent: 2 }, { uuid: "d", indent: 0 },
  ];
  assert.deepEqual([...treeActiveUuids(blocks, "c")].sort(), ["a", "b", "c"]);
  assert.deepEqual([...treeActiveUuids(blocks, null)], []);
});
