import type { GraphLayoutEntry, GraphViewSettings } from "~/lib/api";

export function stablePosition(id: string): { x: number; y: number } {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const value = hash >>> 0;
  const angle = (value % 62832) / 1000;
  const radius = 50 + ((value >>> 8) % 280);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export function mergeLayout(
  ids: string[],
  saved: GraphLayoutEntry[],
): GraphLayoutEntry[] {
  const positions = new Map(saved.map((entry) => [entry.id, entry]));
  return ids.map((id) => {
    const old = positions.get(id);
    if (old && Number.isFinite(old.x) && Number.isFinite(old.y)) return { ...old };
    return { id, ...stablePosition(id), pinned: false };
  });
}

export interface LayoutRequest {
  type: "init" | "update" | "params" | "drag" | "pause" | "resume" | "stop";
  generation: number;
  ids?: string[];
  edges?: { source: string; target: string }[];
  positions?: GraphLayoutEntry[];
  settings?: GraphViewSettings;
  id?: string;
  x?: number;
  y?: number;
  pinned?: boolean;
}

export interface LayoutResponse {
  type: "positions" | "settled";
  generation: number;
  positions?: GraphLayoutEntry[];
}

export interface LayoutCallbacks {
  onPositions: (positions: GraphLayoutEntry[], generation: number) => void;
  onSettled: (generation: number) => void;
}

export function startLayoutWorker(callbacks: LayoutCallbacks) {
  const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
  let generation = 0;
  worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
    const message = event.data;
    if (message.generation !== generation) return;
    if (message.type === "positions" && message.positions) {
      callbacks.onPositions(message.positions, message.generation);
    } else if (message.type === "settled") {
      callbacks.onSettled(message.generation);
    }
  };
  const send = (message: Omit<LayoutRequest, "generation">) => {
    worker.postMessage({ ...message, generation } satisfies LayoutRequest);
  };
  return {
    update: (ids: string[], edges: { source: string; target: string }[], positions: GraphLayoutEntry[], settings: GraphViewSettings) => {
      generation += 1;
      send({ type: "update", ids, edges, positions, settings });
    },
    params: (settings: GraphViewSettings) => send({ type: "params", settings }),
    drag: (id: string, x: number, y: number, pinned: boolean) =>
      send({ type: "drag", id, x, y, pinned }),
    pause: () => send({ type: "pause" }),
    resume: () => send({ type: "resume" }),
    stop: () => {
      send({ type: "stop" });
      worker.terminate();
    },
  };
}
