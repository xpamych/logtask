import test from "node:test";
import assert from "node:assert/strict";
import type { CollisionNode } from "./layout.ts";
import { applyHubGravityOptimized, componentTargets, componentTargetsForComponents, connectedComponents, createLayoutMigration, linkedSceneRadius, mergeLayout, normalizeMainComponent, normalizeMainComponentInPlace, packLayout, separateGraphNodesOptimized, stablePosition, unpackLayout } from "./layout.ts";

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

function referenceHubGravity(nodes: CollisionNode[], hubs: CollisionNode[], linkedIds: ReadonlySet<string>, centerForce = 0.12) {
  const hubIds = new Set(hubs.map((node) => node.id));
  for (const node of nodes) {
    if (node.fx !== undefined && node.fx !== null || node.fy !== undefined && node.fy !== null) continue;
    const hub = hubIds.has(node.id)
      ? undefined
      : hubs.reduce((nearest: CollisionNode | undefined, candidate) => {
          const distance = Math.hypot((candidate.x ?? 0) - (node.x ?? 0), (candidate.y ?? 0) - (node.y ?? 0));
          if (!nearest) return candidate;
          const previous = Math.hypot((nearest.x ?? 0) - (node.x ?? 0), (nearest.y ?? 0) - (node.y ?? 0));
          return distance < previous ? candidate : nearest;
        }, undefined);
    const targetX = hub?.x ?? 0;
    const targetY = hub?.y ?? 0;
    const strength = hubIds.has(node.id)
      ? centerForce * 0.5
      : linkedIds.has(node.id)
        ? centerForce / 6
        : centerForce / 48;
    node.x = (node.x ?? 0) + (targetX - (node.x ?? 0)) * strength;
    node.y = (node.y ?? 0) + (targetY - (node.y ?? 0)) * strength;
  }
}

function referenceSeparateGraphNodes(nodes: CollisionNode[], radii: ReadonlyMap<string, number>, padding = 1) {
  const colliding = nodes.filter((node) => (radii.get(node.id) ?? 0) > 0);
  if (colliding.length < 2) return;
  const maxRadius = Math.max(...colliding.map((node) => radii.get(node.id)!));
  const cellSize = maxRadius * 2 + padding;
  const indices = new Map(colliding.map((node, index) => [node, index]));
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const grid = new Map<string, CollisionNode[]>();
    for (const node of colliding) {
      const key = `${Math.floor((node.x ?? 0) / cellSize)},${Math.floor((node.y ?? 0) / cellSize)}`;
      const cell = grid.get(key) ?? [];
      cell.push(node);
      grid.set(key, cell);
    }
    let changed = false;
    for (let firstIndex = 0; firstIndex < colliding.length; firstIndex += 1) {
      const first = colliding[firstIndex];
      const cellX = Math.floor((first.x ?? 0) / cellSize);
      const cellY = Math.floor((first.y ?? 0) / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const second of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
            if (firstIndex >= indices.get(second)!) continue;
            const firstRadius = radii.get(first.id)!;
            const secondRadius = radii.get(second.id)!;
            const minimum = firstRadius + secondRadius + padding;
            let deltaX = (second.x ?? 0) - (first.x ?? 0);
            let deltaY = (second.y ?? 0) - (first.y ?? 0);
            let distance = Math.hypot(deltaX, deltaY);
            if (distance >= minimum) continue;
            if (distance < 1e-9) {
              const stable = stablePosition(`${first.id}\0${second.id}`);
              distance = Math.hypot(stable.x, stable.y);
              deltaX = stable.x;
              deltaY = stable.y;
            }
            const ux = deltaX / distance;
            const uy = deltaY / distance;
            const shift = minimum - distance + 0.0001;
            const firstFixed = first.fx !== undefined && first.fx !== null;
            const secondFixed = second.fx !== undefined && second.fx !== null;
            const firstShift = firstFixed ? (secondFixed ? shift / 2 : 0) : shift / (secondFixed ? 1 : 2);
            const secondShift = secondFixed ? (firstFixed ? shift / 2 : 0) : shift / (firstFixed ? 1 : 2);
            first.x = (first.x ?? 0) - ux * firstShift;
            first.y = (first.y ?? 0) - uy * firstShift;
            second.x = (second.x ?? 0) + ux * secondShift;
            second.y = (second.y ?? 0) + uy * secondShift;
            if (firstFixed) {
              first.fx = first.x;
              first.fy = first.y;
            }
            if (secondFixed) {
              second.fx = second.x;
              second.fy = second.y;
            }
            first.vx = 0;
            first.vy = 0;
            second.vx = 0;
            second.vy = 0;
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
  }
}

test("optimized_hub_gravity_matches_reference", () => {
  const makeNodes = () => [
    { id: "hub-a", x: 0, y: 0 },
    { id: "hub-b", x: 100, y: 0 },
    { id: "near-a", x: 10, y: 0 },
    { id: "near-b", x: 90, y: 0 },
    { id: "isolated", x: 50, y: 0 },
    { id: "pinned", x: 10, y: 20, fx: 10, fy: 20 },
  ];
  const expected = makeNodes();
  const actual = makeNodes();
  const hubs = expected.slice(0, 2);
  const linked = new Set(["near-a", "near-b"]);

  referenceHubGravity(expected, hubs, linked, 0.12);
  applyHubGravityOptimized(actual, hubs, linked, 0.12);

  assert.deepEqual(actual, expected);
});

test("optimized_collision_separation_matches_reference", () => {
  const makeNodes = () => [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 4, y: 0 },
    { id: "same", x: 4, y: 0 },
    { id: "wide", x: 7, y: 1 },
    { id: "pinned", x: 1, y: 2, fx: 1, fy: 2 },
  ];
  const expected = makeNodes();
  const actual = makeNodes();
  const radii = new Map([["a", 5], ["b", 5], ["same", 5], ["wide", 2], ["pinned", 3]]);

  referenceSeparateGraphNodes(expected, radii);
  separateGraphNodesOptimized(actual, radii);

  assert.deepEqual(actual, expected);
});

test("optimized_hub_gravity_preserves_rounded_tie", () => {
  const makeNodes = () => [{ id: "near", x: 0, y: 0 }];
  const makeHubs = () => [
    { id: "hub-a", x: 1, y: 0 },
    { id: "hub-b", x: 0.6084388609788626, y: 0.7936007512916959 },
  ];
  const expected = makeNodes();
  const actual = makeNodes();
  const expectedHubs = makeHubs();
  const actualHubs = makeHubs();

  referenceHubGravity(expected, expectedHubs, new Set(["near"]), 0.12);
  applyHubGravityOptimized(actual, actualHubs, new Set(["near"]), 0.12);

  assert.deepEqual(actual, expected);
});

test("optimized_collision_filter_preserves_boundary_behavior", () => {
  const makeNodes = () => [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: -0.7373688780783194, y: 0.6754902942615242 },
  ];
  const expected = makeNodes();
  const actual = makeNodes();
  const radii = new Map([["a", 0.4], ["b", 0.4]]);

  referenceSeparateGraphNodes(expected, radii, 0.2);
  separateGraphNodesOptimized(actual, radii, 0.2);

  assert.deepEqual(actual, expected);
});
