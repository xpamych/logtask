import test from "node:test";
import assert from "node:assert/strict";
import { initialNodePositions } from "./layout.ts";

test("новый связанный узел появляется рядом со средней позицией соседей", () => {
  const result = initialNodePositions(
    ["A", "B", "C"],
    [{ source: "A", target: "C" }, { source: "B", target: "C" }],
    [{ id: "A", x: 100, y: 100, pinned: false }, { id: "B", x: 200, y: 100, pinned: true }],
  );
  assert.deepEqual(result[0], { id: "A", x: 100, y: 100, pinned: false });
  assert.deepEqual(result[1], { id: "B", x: 200, y: 100, pinned: true });
  const c = result[2];
  assert(Number.isFinite(c.x) && Number.isFinite(c.y));
  assert(Math.hypot(c.x - 150, c.y - 100) <= 600);
});

test("пустая сцена и новые сироты получают конечные координаты", () => {
  assert.deepEqual(initialNodePositions([], [], []), []);
  const result = initialNodePositions(["A", "B"], [], []);
  assert.equal(result.length, 2);
  for (const node of result) assert(Number.isFinite(node.x) && Number.isFinite(node.y));
});
