import assert from "node:assert/strict";
import test from "node:test";
import { applyHubGravity, selectHubNodes } from "./layout.ts";

test("крупные узлы притягиваются к центру, остальные — к ближайшему крупному", () => {
  const nodes = [
    { id: "hub", x: 100, y: 0, vx: 0, vy: 0 },
    { id: "linked", x: 200, y: 0, vx: 0, vy: 0 },
    { id: "orphan", x: 200, y: 0, vx: 0, vy: 0 },
  ];
  applyHubGravity(nodes, nodes.slice(0, 1), new Set(["hub", "linked"]));
  assert(nodes[0].x < 100);
  assert(nodes[1].x < 200);
  assert(nodes[2].x < 200);
  assert(200 - nodes[2].x < 200 - nodes[1].x);
});

test("хабы выбираются по числу связей, закреплённые не сдвигаются", () => {
  const nodes = [
    { id: "small", x: 10, y: 0 },
    { id: "large", x: 20, y: 0 },
    { id: "medium", x: 30, y: 0 },
  ];
  const degrees = new Map([["small", 1], ["large", 20], ["medium", 5]]);
  assert.deepEqual(selectHubNodes(nodes, degrees, 1).map((node) => node.id), ["large"]);

  const pinned = [{ id: "large", x: 100, y: 50, fx: 100, fy: 50 }];
  applyHubGravity(pinned, pinned, new Set(["large"]));
  assert.deepEqual(pinned[0], { id: "large", x: 100, y: 50, fx: 100, fy: 50 });
});

test("центрирование управляет силой хабов и может отключить её", () => {
  const nodes = [{ id: "hub", x: 100, y: 0 }];
  applyHubGravity(nodes, nodes, new Set(["hub"]), 0);
  assert.equal(nodes[0].x, 100);
  applyHubGravity(nodes, nodes, new Set(["hub"]), 0.24);
  assert.equal(nodes[0].x, 88);
});
