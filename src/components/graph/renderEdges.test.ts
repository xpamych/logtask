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

test("прозрачность подписей следует логарифмической шкале Obsidian", () => {
  assert.equal(nodeLabelOpacity(20, 0.5, 0, false), 0);
  assert.equal(nodeLabelOpacity(20, 1, 0, false), 1);
  assert.equal(nodeLabelOpacity(20, 1, 0.5, false), 0.5);
  assert.equal(nodeLabelOpacity(454, 0.5, 0, false), 0);
  assert.equal(nodeLabelOpacity(20, 0, 0, false), 0);
});

test("экранный масштаб hovered-подписи постоянен при отдалении и растёт при приближении", () => {
  assert.equal(renderEdges.graphLabelScale(0.25, true), 1);
  assert.equal(renderEdges.graphLabelScale(0.25, false), 0.5);
  assert.equal(renderEdges.graphLabelScale(4, true), 2);
  assert.equal(renderEdges.graphLabelScale(4, false), 2);
});

test("экранный отступ подписи уменьшается при отдалении вместе со сценой", () => {
  assert.equal(renderEdges.graphLabelYOffset(20, 0.25, true), 27.5);
  assert.equal(renderEdges.graphLabelYOffset(20, 4, true), 65);
  assert.equal(renderEdges.graphLabelYOffset(20, 0.25, false), 12.5);
  assert.equal(renderEdges.graphLabelYOffset(20, 4, false), 50);
});

test("приоритетные подписи всегда полностью видимы", () => {
  assert.equal(nodeLabelOpacity(454, 0.05, 0.35, true), 1);
});

test("hovered отделён от подсвеченных соседей и приглушённых узлов", () => {
  const highlighted = new Set(["hovered", "neighbor"]);
  assert.equal(renderEdges.graphNodeRole("hovered", "hovered", highlighted), "hovered");
  assert.equal(renderEdges.graphNodeRole("neighbor", "hovered", highlighted), "highlighted");
  assert.equal(renderEdges.graphNodeRole("other", "hovered", highlighted), "muted");
  assert.equal(renderEdges.graphNodeRole("ordinary", null, new Set()), "normal");
});

test("muted-подписи не рендерятся при активном выделении", () => {
  assert.equal(renderEdges.graphNodeLabelOpacity("muted", 454, 2, 0.35), 1);
  assert.equal(renderEdges.graphNodeFinalLabelOpacity("muted", 454, 2, 0.35, 0.2), 0);
  assert.equal(renderEdges.graphNodeFinalLabelOpacity("hovered", 454, 0.05, 0.35, 1), 1);
  assert.equal(renderEdges.graphNodeLabelOpacity("highlighted", 454, 0.05, 0.35), 1);
});

test("радиус узла повторяет формулу Obsidian и сохраняет надбавку кластера", () => {
  assert.equal(renderEdges.graphNodeRadius({ degree: 0 }), 8);
  assert.equal(renderEdges.graphNodeRadius({ degree: 3 }), 8);
  assert.equal(renderEdges.graphNodeRadius({ degree: 8 }), 9);
  assert.equal(renderEdges.graphNodeRadius({ degree: 99 }), 30);
  assert.equal(renderEdges.graphNodeRadius({ degree: 8 }, 2), 18);
  assert.equal(renderEdges.graphNodeRadius({ degree: 8, clusterMembers: ["A", "B"] }), 13);
});

test("ребро пути подсвечивается только при активных обеих вершинах", () => {
  const active = new Set(["A", "B"]);
  assert.equal(renderEdges.isEdgeHighlighted("A", "B", active), true);
  assert.equal(renderEdges.isEdgeHighlighted("B", "A", active), true);
  assert.equal(renderEdges.isEdgeHighlighted("A", "C", active), false);
  assert.equal(renderEdges.isEdgeHighlighted("A", "B", new Set()), false);
});
