import test from "node:test";
import assert from "node:assert/strict";
import type { GraphSnapshotDto } from "~/lib/api";
import { nextGraphFocusIndex, selectGraphNode, selectionHighlight } from "./selection.ts";

const snapshot: GraphSnapshotDto = {
  nodes: [
    { id: "A", title: "A", kind: "page", path: null, tags: [], degree: 1, assetPath: null, exists: true },
    { id: "B", title: "B", kind: "page", path: null, tags: [], degree: 1, assetPath: null, exists: true },
    { id: "C", title: "C", kind: "page", path: null, tags: [], degree: 0, assetPath: null, exists: true },
  ],
  edges: [{ id: "ab", source: "A", target: "B", weight: 1 }],
  revision: 1,
};

test("первый и второй клик показывают путь, третий начинает новый выбор", () => {
  const first = selectGraphNode(null, "A", snapshot);
  assert.deepEqual(first, { first: "A", second: null, path: null, message: null });
  assert.deepEqual(selectionHighlight(first, snapshot), new Set(["A", "B"]));
  const second = selectGraphNode(first, "B", snapshot);
  assert(second);
  assert.deepEqual(second.path, ["A", "B"]);
  assert.equal(second.message, "Путь: 1 переход");
  const third = selectGraphNode(second, "C", snapshot);
  assert.deepEqual(third, { first: "C", second: null, path: null, message: null });
});

test("повторный клик сбрасывает, отсутствие пути сообщается", () => {
  const first = selectGraphNode(null, "A", snapshot);
  assert.equal(selectGraphNode(first, "A", snapshot), null);
  const missing = selectGraphNode(first, "C", snapshot);
  assert(missing);
  assert.equal(missing.path, null);
  assert.equal(missing.message, "Путь не найден");
  assert.deepEqual(selectionHighlight(missing, snapshot), new Set(["A", "C"]));
});

test("клавиатурный фокус безопасен для пустого графа и цикличен", () => {
  assert.equal(nextGraphFocusIndex(0, 1, 0), 0);
  assert.equal(nextGraphFocusIndex(0, -1, 3), 2);
  assert.equal(nextGraphFocusIndex(2, 1, 3), 0);
});
