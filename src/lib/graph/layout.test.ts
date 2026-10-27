import test from "node:test";
import assert from "node:assert/strict";
import { componentTargets, mergeLayout, normalizeMainComponent, packLayout, stablePosition, unpackLayout } from "./layout.ts";

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

test("координаты упаковываются в typed arrays без потери pinned", () => {
  const entries = [
    { id: "A", x: 1.5, y: -2, pinned: true },
    { id: "B", x: 3, y: 4, pinned: false },
  ];
  const packed = packLayout(entries);
  assert(packed.xy instanceof Float32Array);
  assert(packed.pinned instanceof Uint8Array);
  assert.deepEqual(unpackLayout(["A", "B"], packed), entries);
});

test("малые компоненты упаковываются рядом с основной", () => {
  const targets = componentTargets(
    ["A", "B", "C", "D", "E", "F"],
    [
      { source: "A", target: "B" },
      { source: "C", target: "D" },
      { source: "D", target: "E" },
    ],
  );
  assert.equal(targets.has("C"), false);
  assert.equal(targets.has("D"), false);
  assert.equal(targets.has("E"), false);
  assert.equal(targets.has("A"), true);
  assert.equal(targets.has("F"), true);
  assert.equal(targets.size, 2);
  const centers = [...targets.values()];
  assert.notDeepEqual(centers[0], centers[1]);
  for (const center of centers) {
    assert(Math.abs(center.x) <= 600 && Math.abs(center.y) <= 600);
  }
});

test("сироты образуют кольцо вокруг связанных компонент", () => {
  const targets = componentTargets(
    ["A", "B", "C", "D", "E", "F", "G", "H"],
    [
      { source: "A", target: "B" },
      { source: "C", target: "D" },
      { source: "D", target: "E" },
    ],
  );
  const radius = (id: string) => {
    const point = targets.get(id)!;
    return Math.hypot(point.x, point.y);
  };
  assert(Math.abs(radius("F") - radius("G")) < 1e-9);
  assert(Math.abs(radius("G") - radius("H")) < 1e-9);
  assert(radius("F") > radius("A"));
});

test("основная компонента центрируется и получает ограниченный радиус", () => {
  const result = normalizeMainComponent(
    [
      { id: "A", x: 10, y: 0, pinned: false },
      { id: "B", x: 30, y: 0, pinned: false },
    ],
    25,
  );
  assert.deepEqual(result, [
    { id: "A", x: -25, y: 0, pinned: false },
    { id: "B", x: 25, y: 0, pinned: false },
  ]);
});
