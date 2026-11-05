import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import type { LayoutRequest, LayoutResponse } from "./layout.ts";

interface WorkerHarness {
  send: (message: Omit<LayoutRequest, "generation">) => void;
  latest: () => LayoutResponse | undefined;
  history: () => LayoutResponse[];
  close: () => void;
}

async function createWorker(caseId: string): Promise<WorkerHarness> {
  const messages: LayoutResponse[] = [];
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage: (message: LayoutResponse) => messages.push(message) } as unknown as typeof globalThis.self;
  await import(`./layout.worker.ts?${caseId}`);
  return {
    send: (message) => globalThis.self.onmessage?.({ data: { ...message, generation: 1 } } as MessageEvent<LayoutRequest>),
    latest: () => messages.at(-1),
    history: () => messages,
    close: () => {
      globalThis.self.onmessage?.({ data: { type: "stop", generation: 1 } } as MessageEvent<LayoutRequest>);
      globalThis.self = previousSelf;
    },
  };
}

function position(response: LayoutResponse | undefined, id: string) {
  const index = response?.ids?.indexOf(id) ?? -1;
  assert(index >= 0);
  return { x: response!.positions!.xy[index * 2], y: response!.positions!.xy[index * 2 + 1] };
}

const twoNodeLayout = () => ({
  type: "update" as const,
  ids: ["A", "B"],
  edges: [{ source: "A", target: "B" }],
  positions: { xy: new Float32Array([-20, 0, 20, 0]), pinned: new Uint8Array(2) },
  settings: DEFAULT_GRAPH_VIEW_SETTINGS,
  alpha: 0,
});

test("свободная раскладка сохраняет вручную закреплённые узлы", async (t) => {
  const worker = await createWorker("free-pinned");
  t.after(() => worker.close());
  worker.send({
    type: "init",
    ids: ["A", "B", "C", "D", "F"],
    edges: [{ source: "A", target: "B" }, { source: "C", target: "D" }],
    positions: { xy: new Float32Array([-20, 0, 20, 0, 300, 300, 310, 300, 400, 400]), pinned: new Uint8Array([0, 0, 1, 0, 1]) },
    settings: DEFAULT_GRAPH_VIEW_SETTINGS,
  });
  assert.deepEqual(position(worker.latest(), "C"), { x: 300, y: 300 });
  assert.deepEqual(position(worker.latest(), "F"), { x: 400, y: 400 });
  worker.send({ type: "drag", id: "F", x: 450, y: 425, pinned: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(position(worker.latest(), "F"), { x: 450, y: 425 });
});

test("alpha = 0 показывает сохранённую раскладку одним кадром и не нагревается при resume", async (t) => {
  const worker = await createWorker("static-free-layout");
  t.after(() => worker.close());
  worker.send(twoNodeLayout());
  assert.equal(worker.history().filter((response) => response.type === "positions").length, 1);
  assert.deepEqual(position(worker.history()[0], "A"), { x: -20, y: 0 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  worker.send({ type: "resume" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(worker.history().filter((response) => response.type === "positions").length, 1);
  assert.equal(worker.latest()?.type, "settled");
});

test("статичный update во время pause не запускается при resume", async (t) => {
  const worker = await createWorker("paused-static-free-layout");
  t.after(() => worker.close());
  worker.send({ type: "pause" });
  worker.send(twoNodeLayout());
  assert.equal(worker.history().filter((response) => response.type === "positions").length, 1);
  worker.send({ type: "resume" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(worker.history().filter((response) => response.type === "positions").length, 1);
  assert.equal(worker.latest()?.type, "settled");
});

test("изменение параметров во время pause запускается после resume", async (t) => {
  const worker = await createWorker("paused-free-params");
  t.after(() => worker.close());
  worker.send(twoNodeLayout());
  worker.send({ type: "pause" });
  worker.send({ type: "params", settings: { ...DEFAULT_GRAPH_VIEW_SETTINGS, linkDistance: 55 } });
  worker.send({ type: "resume" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(worker.history().filter((response) => response.type === "positions").length > 1);
});

test("совпадающие координаты и self-link не создают NaN", async (t) => {
  const worker = await createWorker("finite-free-layout");
  t.after(() => worker.close());
  worker.send({
    type: "update",
    ids: ["A", "B"],
    edges: [{ source: "A", target: "A" }, { source: "A", target: "B" }],
    positions: { xy: new Float32Array(4), pinned: new Uint8Array(2) },
    settings: DEFAULT_GRAPH_VIEW_SETTINGS,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const response of worker.history()) {
    if (response.positions) assert([...response.positions.xy].every(Number.isFinite));
  }
});

test("последовательный drag сохраняет работу сил и последнюю точку", async (t) => {
  const worker = await createWorker("continuous-free-drag");
  t.after(() => worker.close());
  worker.send({
    type: "init",
    ids: ["A", "B"],
    edges: [{ source: "A", target: "B" }],
    positions: { xy: new Float32Array([-20, 0, 20, 0]), pinned: new Uint8Array(2) },
    settings: { ...DEFAULT_GRAPH_VIEW_SETTINGS, alphaDecay: 0, qualityTickMs: 5 },
  });
  worker.send({ type: "drag", id: "A", x: 100, y: 100, pinned: true, alphaTarget: 0.3 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  worker.send({ type: "drag", id: "A", x: 110, y: 105, pinned: true, alphaTarget: 0.3 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(position(worker.latest(), "A"), { x: 110, y: 105 });
  const points = worker.history().filter((response) => response.type === "positions").map((response) => position(response, "B"));
  assert(points.some((point) => point.x !== points[0].x || point.y !== points[0].y));
});
