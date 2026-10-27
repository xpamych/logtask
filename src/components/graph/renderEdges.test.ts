import test from "node:test";
import assert from "node:assert/strict";
import { indexSceneNodes, mergeRenderEdges, shouldShowNodeLabel } from "./renderEdges.ts";

test("встречные ссылки дают одну линию со стрелками на обоих концах", () => {
  const result = mergeRenderEdges([
    { id: "A->B", source: "A", target: "B", weight: 2 },
    { id: "B->A", source: "B", target: "A", weight: 1 },
  ]);
  assert.deepEqual(result, [{ source: "A", target: "B", weight: 3, forward: true, backward: true }]);
});

test("повторное направление не повторяет линию, петля остаётся", () => {
  const result = mergeRenderEdges([
    { id: "A->B", source: "A", target: "B", weight: 1 },
    { id: "A->B", source: "A", target: "B", weight: 2 },
    { id: "A->A", source: "A", target: "A", weight: 1 },
  ]);
  assert.deepEqual(result, [
    { source: "A", target: "B", weight: 3, forward: true, backward: false },
    { source: "A", target: "A", weight: 1, forward: true, backward: false },
  ]);
});

test("узлы индексируются по id без линейного поиска", () => {
  const nodes = [
    { id: "A", title: "A", kind: "page" as const, path: null, tags: [], degree: 0, assetPath: null, exists: true },
    { id: "B", title: "B", kind: "page" as const, path: null, tags: [], degree: 0, assetPath: null, exists: true },
  ];
  const index = indexSceneNodes(nodes);
  assert.equal(index.get("B"), nodes[1]);
  assert.equal(index.size, 2);
});

test("подписи скрываются при обзоре большого графа и возвращаются при приближении", () => {
  assert.equal(shouldShowNodeLabel(454, 0.5, 0.35, false), false);
  assert.equal(shouldShowNodeLabel(454, 2, 0.35, false), true);
  assert.equal(shouldShowNodeLabel(454, 0.5, 0.35, true), true);
  assert.equal(shouldShowNodeLabel(20, 0.5, 0.35, false), true);
});
