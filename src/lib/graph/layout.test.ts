import test from "node:test";
import assert from "node:assert/strict";
import { componentTargets, componentTargetsForComponents, connectedComponents, createLayoutMigration, linkedSceneRadius, mergeLayout, normalizeMainComponent, normalizeMainComponentInPlace, packLayout, stablePosition, unpackLayout } from "./layout.ts";

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

test("in-place нормализация сохраняет координаты и дополнительные поля", () => {
  const entries = [
    { id: "A", x: 10, y: 0, pinned: false, label: "первый" },
    { id: "B", x: 30, y: 5, pinned: true, label: "второй" },
  ];
  const originalEntries = [...entries];
  const expected = normalizeMainComponent(entries, 25);

  normalizeMainComponentInPlace(entries, 25);

  assert.deepEqual(entries, expected);
  entries.forEach((entry, index) => assert.strictEqual(entry, originalEntries[index]));
});

test("in-place нормализация пустого набора ничего не меняет", () => {
  const entries: { id: string; x?: number; y?: number }[] = [];

  normalizeMainComponentInPlace(entries, 25);

  assert.deepEqual(entries, []);
});

test("in-place нормализация вырожденного набора совпадает с исходной", () => {
  const entries = [
    { id: "A", pinned: false },
    { id: "B", x: 0, y: 0, pinned: true },
  ];
  const expected = normalizeMainComponent(entries, 25);

  normalizeMainComponentInPlace(entries, 25);

  assert.deepEqual(entries, expected);
});

test("радиус связанной сцены учитывает только компоненты больше одного узла", () => {
  assert.equal(linkedSceneRadius([
    [{ id: "orphan", x: 1000, y: 1000 }],
    [{ id: "A", x: 30, y: 40 }, { id: "B", x: -10, y: 0 }],
  ]), 50);
});

test("радиус связанной сцены конечен и неотрицателен без связанных узлов", () => {
  for (const components of [
    [],
    [[{ id: "A" }]],
    [[{ id: "A", x: 10, y: 20 }], [{ id: "B", x: -30, y: 40 }]],
  ]) {
    const radius = linkedSceneRadius(components);
    assert(Number.isFinite(radius));
    assert(radius >= 0);
  }
});

test("явный радиус кольца общий для сирот и больше радиуса малых компонент", () => {
  const targets = componentTargetsForComponents(
    [["A", "B"], ["C", "D"], ["E"], ["F"]],
    300,
  );
  const radius = (id: string) => {
    const point = targets.get(id)!;
    return Math.hypot(point.x, point.y);
  };
  assert.equal(radius("E"), 300);
  assert.equal(radius("F"), 300);
  assert(radius("C") < 300);
});

test("граф только из сирот распределяет все узлы по одному кольцу", () => {
  const targets = componentTargetsForComponents([["A"], ["B"], ["C"]], 200);
  assert.equal(targets.size, 3);
  for (const point of targets.values()) {
    assert(Math.abs(Math.hypot(point.x, point.y) - 200) < 1e-9);
  }
});

test("цели компонент можно построить по уже найденным компонентам", () => {
  const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const edges = [
    { source: "A", target: "B" },
    { source: "C", target: "D" },
    { source: "D", target: "E" },
  ];

  assert.deepEqual(
    componentTargetsForComponents(connectedComponents(ids, edges)),
    componentTargets(ids, edges),
  );
});

test("миграция запрашивает fit только для первого кадра позиций Worker", () => {
  const migration = createLayoutMigration();
  assert.equal(migration.consumeFit(), false);
  migration.begin();
  assert.equal(migration.consumeFit(), true);
  assert.equal(migration.consumeFit(), false);
  assert.equal(migration.consumeFit(), false);
});

test("миграция отмечает версию после успешного flush", async () => {
  const migration = createLayoutMigration();
  const events: string[] = [];
  await migration.complete(
    async () => { events.push("save"); },
    () => { events.push("mark"); },
  );
  assert.deepEqual(events, ["save", "mark"]);
});

test("миграция не отмечает версию при отклонённом flush", async () => {
  const migration = createLayoutMigration();
  let marked = false;
  await assert.rejects(migration.complete(
    async () => { throw new Error("disk full"); },
    () => { marked = true; },
  ), /disk full/);
  assert.equal(marked, false);
});
