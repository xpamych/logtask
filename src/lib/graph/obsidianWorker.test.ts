import test from "node:test";
import assert from "node:assert/strict";
import { forceSimulation } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import type { LayoutRequest, LayoutResponse } from "./layout.ts";

interface Node extends SimulationNodeDatum { id: string }

test("симуляция получает точные силы Obsidian", async (t) => {
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage: () => undefined } as unknown as typeof globalThis.self;
  t.after(() => { globalThis.self = previousSelf; });
  const module = await import("./layout.worker.ts");
  const nodes: Node[] = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }];
  const links: SimulationLinkDatum<Node>[] = [
    { source: "A", target: "B" },
    { source: "A", target: "C" },
    { source: "B", target: "D" },
    { source: "B", target: "E" },
  ];
  const simulation = forceSimulation(nodes).stop();
  t.after(() => simulation.stop());
  module.configureObsidianSimulation(simulation, links, DEFAULT_GRAPH_VIEW_SETTINGS);

  assert.equal(simulation.velocityDecay(), 0.4);
  const link = simulation.force("link") as ReturnType<typeof import("d3-force").forceLink<Node, SimulationLinkDatum<Node>>>;
  assert.equal(link.strength()(links[0], 0, links), 0.5);
  assert.equal(link.distance()(links[0], 0, links), 250);
  const charge = simulation.force("charge") as ReturnType<typeof import("d3-force").forceManyBody<Node>>;
  assert.equal(charge.strength()(nodes[0], 0, nodes), -1000);
  assert.equal(charge.distanceMin(), 30);
  assert.equal(charge.theta(), 0.9);
  const collide = simulation.force("collide") as ReturnType<typeof import("d3-force").forceCollide<Node>>;
  assert.equal(collide.radius()(nodes[0], 0, nodes), 60);
  assert.equal(collide.strength(), 0.5);
  const centerX = simulation.force("x") as ReturnType<typeof import("d3-force").forceX<Node>>;
  const centerY = simulation.force("y") as ReturnType<typeof import("d3-force").forceY<Node>>;
  assert.equal(centerX.strength()(nodes[0], 0, nodes), 0.1);
  assert.equal(centerY.strength()(nodes[0], 0, nodes), 0.1);
});

test("drag держит alphaTarget 0.3 и останавливается после отпускания", async (t) => {
  const messages: LayoutResponse[] = [];
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage: (message: LayoutResponse) => messages.push(message) } as unknown as typeof globalThis.self;
  const workerPath = "./layout.worker.ts";
  await import(`${workerPath}?drag-target`);
  const send = (message: Omit<LayoutRequest, "generation">) => globalThis.self.onmessage?.({ data: { ...message, generation: 1 } } as MessageEvent<LayoutRequest>);
  t.after(() => {
    send({ type: "stop" });
    globalThis.self = previousSelf;
  });
  send({
    type: "init",
    ids: ["A", "B"],
    edges: [{ source: "A", target: "B" }],
    positions: { xy: new Float32Array([-20, 0, 20, 0]), pinned: new Uint8Array(2) },
    settings: { ...DEFAULT_GRAPH_VIEW_SETTINGS, alphaDecay: 1 },
  });
  send({ type: "drag", id: "A", x: 100, y: 100, pinned: true, alphaTarget: 0.3 });
  const dragDeadline = Date.now() + 500;
  while (messages.filter((message) => message.type === "positions").length <= 4 && Date.now() < dragDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(messages.filter((message) => message.type === "positions").length > 4);
  send({ type: "drag", id: "A", x: 100, y: 100, pinned: false, alphaTarget: 0 });
  const deadline = Date.now() + 3000;
  while (messages.at(-1)?.type !== "settled" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(messages.at(-1)?.type, "settled");
});
