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
  globalThis.self = {
    postMessage: (message: LayoutResponse) => messages.push(message),
  } as unknown as typeof globalThis.self;
  await import(`./layout.worker.ts?${caseId}`);
  return {
    send: (message) => globalThis.self.onmessage?.({
      data: { ...message, generation: 1 },
    } as MessageEvent<LayoutRequest>),
    latest: () => messages.at(-1),
    history: () => messages,
    close: () => {
      globalThis.self.onmessage?.({
        data: { type: "stop", generation: 1 },
      } as MessageEvent<LayoutRequest>);
      globalThis.self = previousSelf;
    },
  };
}

function position(response: LayoutResponse | undefined, id: string) {
  const index = response?.ids?.indexOf(id) ?? -1;
  assert(index >= 0);
  return {
    x: response!.positions!.xy[index * 2],
    y: response!.positions!.xy[index * 2 + 1],
  };
}

test("компонентная раскладка не перемещает вручную закреплённые узлы", async (t) => {
  const worker = await createWorker("pinned");
  t.after(() => worker.close());
  worker.send({
    type: "init",
    ids: ["A", "B", "C", "D", "F"],
    edges: [{ source: "A", target: "B" }, { source: "C", target: "D" }],
    positions: {
      xy: new Float32Array([-20, 0, 20, 0, 300, 300, 310, 300, 400, 400]),
      pinned: new Uint8Array([0, 0, 1, 0, 1]),
    },
    settings: DEFAULT_GRAPH_VIEW_SETTINGS,
  });
  assert.deepEqual(position(worker.latest(), "C"), { x: 300, y: 300 });
  assert.deepEqual(position(worker.latest(), "F"), { x: 400, y: 400 });

  worker.send({ type: "drag", id: "F", x: 450, y: 425, pinned: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(position(worker.latest(), "F"), { x: 450, y: 425 });
});

test("self-link не добавляет одиночную компоненту в силы связанной сцены", async (t) => {
  async function mainDistance(withSelfLink: boolean) {
    const worker = await createWorker(`self-${withSelfLink}`);
    worker.send({
      type: "init",
      ids: ["A", "B", "E"],
      edges: [
        { source: "A", target: "B" },
        ...(withSelfLink ? [{ source: "E", target: "E" }] : []),
      ],
      positions: {
        xy: new Float32Array([-20, 0, 20, 0, 0, 0]),
        pinned: new Uint8Array(3),
      },
      settings: DEFAULT_GRAPH_VIEW_SETTINGS,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const a = position(worker.latest(), "A");
    const b = position(worker.latest(), "B");
    worker.close();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const withoutSelfLink = await mainDistance(false);
  const withSelfLink = await mainDistance(true);
  t.diagnostic(`distance without self-link: ${withoutSelfLink}; with: ${withSelfLink}`);
  assert(Math.abs(withoutSelfLink - withSelfLink) < 1e-6);
});

test("сироты и вторичные компоненты не уводят абсолютный центр связанной сцены", async (t) => {
  const worker = await createWorker("linked-center");
  t.after(() => worker.close());
  worker.send({
    type: "init",
    ids: ["A", "B", "C", "D", "E", "F"],
    edges: [{ source: "A", target: "B" }, { source: "C", target: "D" }],
    positions: {
      xy: new Float32Array([-20, 0, 20, 0, 200, 0, 220, 0, 400, 400, -400, -400]),
      pinned: new Uint8Array(6),
    },
    settings: DEFAULT_GRAPH_VIEW_SETTINGS,
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const responses = worker.history().filter((response) => response.type === "positions");
  assert(responses.length > 5);
  const distances = responses.map((response) => {
    const a = position(response, "A");
    const b = position(response, "B");
    return Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
  });
  const maximum = Math.max(...distances);
  t.diagnostic(`maximum linked-center distance: ${maximum}; frames: ${responses.length}`);
  assert(maximum < 30, `центр связанной сцены сместился на ${maximum}`);
});
