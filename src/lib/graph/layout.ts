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
  return componentTargetsForComponents(connectedComponents(ids, edges));
}

export function linkedSceneRadius(
  components: { id: string; x?: number; y?: number }[][],
): number {
  let radius = 0;
  for (const component of components) {
    if (component.length <= 1) continue;
    for (const node of component) {
      radius = Math.max(radius, Math.hypot(node.x ?? 0, node.y ?? 0));
    }
  }
  return radius;
}

export function componentTargetsForComponents(
  components: string[][],
  orphanRadius?: number,
): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>();
  const linkedCount = components
    .filter((component) => component.length > 1)
    .reduce((sum, component) => sum + component.length, 0);
  const innerRadius = Math.max(80, Math.sqrt(linkedCount) * 7);
  const outerRadius = orphanRadius ?? innerRadius + 120;
  const singleTotal = components.filter((component) => component.length === 1).length;
  let smallIndex = 0;
  let singleIndex = 0;
  const startIndex = components[0]?.length === 1 ? 0 : 1;
  for (let index = startIndex; index < components.length; index += 1) {
    const singleton = components[index].length === 1;
    const angle = singleton
      ? (singleIndex++ * Math.PI * 2) / singleTotal
      : smallIndex++ * 2.399963229728653;
    const radius = singleton ? outerRadius : innerRadius * 0.75;
    targets.set(components[index][0], {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  return targets;
}

export function normalizeMainComponent<T extends { x?: number; y?: number }>(
  entries: T[],
  targetRadius: number,
): T[] {
  if (entries.length === 0) return entries;
  const centerX = entries.reduce((sum, entry) => sum + (entry.x ?? 0), 0) / entries.length;
  const centerY = entries.reduce((sum, entry) => sum + (entry.y ?? 0), 0) / entries.length;
  const currentRadius = Math.max(...entries.map((entry) =>
    Math.hypot((entry.x ?? 0) - centerX, (entry.y ?? 0) - centerY),
  ));
  if (currentRadius < 0.0001) {
    return entries.map((entry) => ({ ...entry, x: 0, y: 0 }));
  }
  const scale = targetRadius / currentRadius;
  return entries.map((entry) => ({
    ...entry,
    x: ((entry.x ?? 0) - centerX) * scale,
    y: ((entry.y ?? 0) - centerY) * scale,
  }));
}

export function normalizeMainComponentInPlace<T extends { x?: number; y?: number }>(
  entries: T[],
  targetRadius: number,
): void {
  if (entries.length === 0) return;
  const centerX = entries.reduce((sum, entry) => sum + (entry.x ?? 0), 0) / entries.length;
  const centerY = entries.reduce((sum, entry) => sum + (entry.y ?? 0), 0) / entries.length;
  let currentRadius = 0;
  for (const entry of entries) {
    currentRadius = Math.max(
      currentRadius,
      Math.hypot((entry.x ?? 0) - centerX, (entry.y ?? 0) - centerY),
    );
  }
  if (currentRadius < 0.0001) {
    for (const entry of entries) {
      entry.x = 0;
      entry.y = 0;
    }
    return;
  }
  const scale = targetRadius / currentRadius;
  for (const entry of entries) {
    entry.x = ((entry.x ?? 0) - centerX) * scale;
    entry.y = ((entry.y ?? 0) - centerY) * scale;
  }
}

export function createLayoutMigration() {
  let fitPending = false;
  return {
    begin() {
      fitPending = true;
    },
    consumeFit() {
      if (!fitPending) return false;
      fitPending = false;
      return true;
    },
    async complete(flush: () => Promise<void>, mark: () => void) {
      await flush();
      mark();
    },
  };
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

export interface CollisionNode {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export function separateGraphNodes(
  nodes: CollisionNode[],
  radii: ReadonlyMap<string, number>,
  padding = 1,
): void {
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
  alpha?: number;
  radii?: number[];
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
    update: (ids: string[], edges: { source: string; target: string }[], positions: GraphLayoutEntry[], settings: GraphViewSettings, alpha?: number, radii?: number[]) => {
      generation += 1;
      const packed = packLayout(positions);
      send({ type: "update", ids, edges, positions: packed, settings, alpha, radii }, [packed.xy.buffer, packed.pinned.buffer]);
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
