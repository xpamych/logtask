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

export function connectedComponents(
  ids: string[],
  edges: { source: string; target: string }[],
): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  const remaining = new Set(ids);
  const components: string[][] = [];
  while (remaining.size > 0) {
    const start = [...remaining].sort()[0];
    const queue = [start];
    const component: string[] = [];
    remaining.delete(start);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (remaining.delete(next)) queue.push(next);
      }
    }
    components.push(component.sort());
  }
  return components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function componentTargets(
  ids: string[],
  edges: { source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const components = connectedComponents(ids, edges);
  const targets = new Map<string, { x: number; y: number }>();
  const otherCount = Math.max(0, components.length - 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(otherCount)));
  for (let index = 1; index < components.length; index += 1) {
    const other = index - 1;
    targets.set(components[index][0], {
      x: ((other % columns) - (columns - 1) / 2) * 260,
      y: Math.floor(other / columns) * 220,
    });
  }
  return targets;
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

export interface PackedLayout {
  xy: Float32Array;
  pinned: Uint8Array;
}

export function packLayout(entries: GraphLayoutEntry[]): PackedLayout {
  const xy = new Float32Array(entries.length * 2);
  const pinned = new Uint8Array(entries.length);
  entries.forEach((entry, index) => {
    xy[index * 2] = entry.x;
    xy[index * 2 + 1] = entry.y;
    pinned[index] = entry.pinned ? 1 : 0;
  });
  return { xy, pinned };
}

export function unpackLayout(ids: string[], packed: PackedLayout): GraphLayoutEntry[] {
  return ids.map((id, index) => ({
    id,
    x: packed.xy[index * 2],
    y: packed.xy[index * 2 + 1],
    pinned: packed.pinned[index] === 1,
  }));
}

export interface LayoutRequest {
  type: "init" | "update" | "params" | "drag" | "pause" | "resume" | "stop";
  generation: number;
  ids?: string[];
  edges?: { source: string; target: string }[];
  positions?: PackedLayout;
  settings?: GraphViewSettings;
  id?: string;
  x?: number;
  y?: number;
  pinned?: boolean;
}

export interface LayoutResponse {
  type: "positions" | "settled";
  generation: number;
  ids?: string[];
  positions?: PackedLayout;
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
    if (message.type === "positions" && message.positions && message.ids) {
      callbacks.onPositions(unpackLayout(message.ids, message.positions), message.generation);
    } else if (message.type === "settled") {
      callbacks.onSettled(message.generation);
    }
  };
  const send = (message: Omit<LayoutRequest, "generation">, transfer: Transferable[] = []) => {
    worker.postMessage({ ...message, generation } satisfies LayoutRequest, transfer);
  };
  return {
    update: (ids: string[], edges: { source: string; target: string }[], positions: GraphLayoutEntry[], settings: GraphViewSettings) => {
      generation += 1;
      const packed = packLayout(positions);
      send({ type: "update", ids, edges, positions: packed, settings }, [packed.xy.buffer, packed.pinned.buffer]);
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
