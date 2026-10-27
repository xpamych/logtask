import test from "node:test";
import assert from "node:assert/strict";
import * as renderEdges from "./renderEdges.ts";

const { indexSceneNodes, mergeRenderEdges, nodeLabelOpacity } = renderEdges;

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

test("кэш рёбер пересчитывает только новый список", () => {
  const cached = renderEdges.createRenderEdgeCache();
  const edges = [{ id: "A->B", source: "A", target: "B", weight: 1 }];
  const first = cached(edges);
  assert.strictEqual(cached(edges), first);
  const changed = [...edges, { id: "A->B-2", source: "A", target: "B", weight: 2 }];
  const second = cached(changed);
  assert.notStrictEqual(second, first);
  assert.deepEqual(second, [{ source: "A", target: "B", weight: 3, forward: true, backward: false }]);
});

test("кэш рёбер сохраняет встречные направления и петли", () => {
  const cached = renderEdges.createRenderEdgeCache();
  const result = cached([
    { id: "A->B", source: "A", target: "B", weight: 2 },
    { id: "B->A", source: "B", target: "A", weight: 1 },
    { id: "A->A", source: "A", target: "A", weight: 4 },
  ]);
  assert.deepEqual(result, [
    { source: "A", target: "B", weight: 3, forward: true, backward: true },
    { source: "A", target: "A", weight: 4, forward: true, backward: false },
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

test("обычные подписи плавно проявляются после порога", () => {
  assert.equal(nodeLabelOpacity(20, 0.2, 0.35, false), 0);
  assert.equal(nodeLabelOpacity(20, 0.35, 0.35, false), 0);
  assert.equal(nodeLabelOpacity(20, 0.6, 0.35, false), 0.5);
  assert.equal(nodeLabelOpacity(20, 0.85, 0.35, false), 1);
});

test("приоритетные подписи всегда полностью видимы", () => {
  assert.equal(nodeLabelOpacity(454, 0.05, 0.35, true), 1);
});

test("обычные подписи большого графа скрыты на обзорном масштабе", () => {
  assert.equal(nodeLabelOpacity(454, 0.5, 0.35, false), 0);
  assert.equal(nodeLabelOpacity(454, 2, 0.35, false), 1);
});

test("прозрачность подписей ограничена диапазоном от нуля до единицы", () => {
  assert.equal(nodeLabelOpacity(20, -1, 0.35, false), 0);
  assert.equal(nodeLabelOpacity(20, 10, 0.35, false), 1);
  assert.equal(nodeLabelOpacity(20, 0.6, -1, false), 1);
});
