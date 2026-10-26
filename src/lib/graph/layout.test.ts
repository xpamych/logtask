import test from "node:test";
import assert from "node:assert/strict";
import { mergeLayout, stablePosition } from "./layout.ts";

test("стартовые координаты детерминированы и конечны", () => {
  const a = stablePosition("page:А");
  assert.deepEqual(a, stablePosition("page:А"));
  assert.notDeepEqual(a, stablePosition("page:Б"));
  assert(Number.isFinite(a.x) && Number.isFinite(a.y));
});

test("сохранённые координаты и фиксация восстанавливаются, новые узлы добавляются", () => {
  const result = mergeLayout(
    ["page:A", "page:B", "page:C"],
    [{ id: "page:B", x: 42, y: -7, pinned: true }],
  );
  assert.deepEqual(result[1], { id: "page:B", x: 42, y: -7, pinned: true });
  assert.deepEqual(result[0], { id: "page:A", ...stablePosition("page:A"), pinned: false });
  assert.deepEqual(result[2], { id: "page:C", ...stablePosition("page:C"), pinned: false });
});
