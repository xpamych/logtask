import { forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { Force, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { GraphViewSettings } from "~/lib/api";
import type { LayoutRequest } from "./layout.ts";
import { componentTargetsForComponents, connectedComponents, linkedSceneRadius, mergeLayout, normalizeMainComponentInPlace, packLayout, stablePosition, unpackLayout } from "./layout.ts";

interface WorkerNode extends SimulationNodeDatum {
  id: string;
}

let simulation: ReturnType<typeof forceSimulation<WorkerNode>> | null = null;
let nodes: WorkerNode[] = [];
let links: SimulationLinkDatum<WorkerNode>[] = [];
let settings: GraphViewSettings | null = null;
let generation = 0;
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let randomState = 1;

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}

let components: WorkerNode[][] = [];
let targets = new Map<string, { x: number; y: number }>();
let linkedNodeIds = new Set<string>();
let centeredNodeIds = new Set<string>();
let orphanRadius = 120;

function forceMainCenter(strength: number): Force<WorkerNode, undefined> {
  let initializedNodes: WorkerNode[] = [];
  const force = (_alpha: number) => {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (const node of initializedNodes) {
      if (!centeredNodeIds.has(node.id)) continue;
      count += 1;
      sumX += node.x ?? 0;
      sumY += node.y ?? 0;
    }
    if (count === 0) return;
    const shiftX = (sumX / count) * strength;
    const shiftY = (sumY / count) * strength;
    for (const node of initializedNodes) {
      if (!centeredNodeIds.has(node.id)) continue;
      node.x = (node.x ?? 0) - shiftX;
      node.y = (node.y ?? 0) - shiftY;
    }
  };
  force.initialize = (nodes: WorkerNode[]) => {
    initializedNodes = nodes;
  };
  return force;
}

function updateComponentTargets(smooth: boolean) {
  const desiredRadius = linkedSceneRadius(components) + 120;
  orphanRadius = smooth ? orphanRadius + (desiredRadius - orphanRadius) * 0.15 : desiredRadius;
  targets = componentTargetsForComponents(
    components.map((component) => component.map((node) => node.id)),
    orphanRadius,
  );
}

function applyComponentTargets() {
  const startIndex = components[0]?.length === 1 ? 0 : 1;
  for (let index = startIndex; index < components.length; index += 1) {
    const component = components[index];
    if (component.length === 0) continue;
    const target = targets.get(component[0].id);
    if (!target) continue;
    const pinnedPositions = component
      .filter((node) => node.fx !== undefined && node.fx !== null)
      .map((node) => ({ node, x: node.x, y: node.y }));
    if (component.length > 1) {
      normalizeMainComponentInPlace(component, Math.max(12, Math.sqrt(component.length) * 5));
    }
    const centerX = component.reduce((sum, node) => sum + (node.x ?? 0), 0) / component.length;
    const centerY = component.reduce((sum, node) => sum + (node.y ?? 0), 0) / component.length;
    for (const node of component) {
      node.x = (node.x ?? 0) + target.x - centerX;
      node.y = (node.y ?? 0) + target.y - centerY;
      if (component.length === 1) {
        node.vx = 0;
        node.vy = 0;
      }
    }
    for (const { node, x, y } of pinnedPositions) {
      node.x = x;
      node.y = y;
    }
  }
}

function postPositions() {
  const entries = nodes.map((node) => ({
    id: node.id,
    x: Number.isFinite(node.x) ? node.x! : stablePosition(node.id).x,
    y: Number.isFinite(node.y) ? node.y! : stablePosition(node.id).y,
    pinned: node.fx !== undefined && node.fx !== null,
  }));
  const positions = packLayout(entries);
  (self as unknown as {
    postMessage: (message: unknown, transfer: Transferable[]) => void;
  }).postMessage(
    { type: "positions", generation, ids: nodes.map((node) => node.id), positions },
    [positions.xy.buffer, positions.pinned.buffer],
  );
}

function tick() {
  if (!simulation || paused) return;
  for (let index = 0; index < 8; index += 1) simulation.tick();
  updateComponentTargets(true);
  applyComponentTargets();
  postPositions();
  if (simulation.alpha() < simulation.alphaMin()) {
    self.postMessage({ type: "settled", generation });
    return;
  }
  timer = setTimeout(tick, settings?.qualityTickMs ?? 16);
}

function restart(alpha = 0.7) {
  clearTimeout(timer);
  if (!paused) {
    simulation?.alpha(alpha).restart();
    simulation?.stop();
    timer = setTimeout(tick, 0);
  }
}

function applyForces() {
  if (!simulation || !settings) return;
  const currentSettings = settings;
  simulation
    .force(
      "charge",
      forceManyBody<WorkerNode>().strength((node) =>
        linkedNodeIds.has(node.id) ? -currentSettings.repelForce : 0
      ),
    )
    .force(
      "collide",
      forceCollide<WorkerNode>().radius((node) => linkedNodeIds.has(node.id) ? 5 : 0),
    )
    .force(
      "link",
      forceLink<WorkerNode, SimulationLinkDatum<WorkerNode>>(links)
        .id((node) => node.id)
        .distance(currentSettings.linkDistance)
        .strength(currentSettings.linkForce),
    )
    .force("center", forceMainCenter(currentSettings.centerForce));
  simulation.alphaDecay(currentSettings.alphaDecay).randomSource(random);
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const message = event.data;
  generation = message.generation;
  if (message.type === "stop") {
    clearTimeout(timer);
    simulation?.stop();
    simulation = null;
    return;
  }
  if (message.type === "pause") {
    paused = true;
    clearTimeout(timer);
    simulation?.stop();
    return;
  }
  if (message.type === "resume") {
    paused = false;
    restart();
    return;
  }
  if (message.type === "params" && message.settings) {
    settings = message.settings;
    applyForces();
    restart(0.3);
    return;
  }
  if (message.type === "drag" && message.id && message.x !== undefined && message.y !== undefined) {
    const node = nodes.find((candidate) => candidate.id === message.id);
    if (node) {
      node.x = message.x;
      node.y = message.y;
      node.fx = message.pinned ? message.x : undefined;
      node.fy = message.pinned ? message.y : undefined;
      postPositions();
      restart();
    }
    return;
  }
  if ((message.type === "init" || message.type === "update") && message.ids && message.settings) {
    settings = message.settings;
    const positions = message.positions
      ? unpackLayout(message.ids, message.positions)
      : mergeLayout(message.ids, []);
    nodes = positions.map((position) => ({
      id: position.id,
      x: position.x,
      y: position.y,
      fx: position.pinned ? position.x : undefined,
      fy: position.pinned ? position.y : undefined,
    }));
    links = (message.edges ?? []).map((edge) => ({ ...edge }));
    simulation?.stop();
    simulation = forceSimulation(nodes).stop();
    const componentIds = connectedComponents(message.ids, message.edges ?? []);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    components = componentIds.map((component) =>
      component
        .map((id) => byId.get(id))
        .filter((node): node is WorkerNode => Boolean(node)),
    );
    linkedNodeIds = new Set(
      components
        .filter((component) => component.length > 1)
        .flatMap((component) => component.map((node) => node.id)),
    );
    centeredNodeIds = new Set(
      components[0]?.length > 1 ? components[0].map((node) => node.id) : [],
    );
    applyForces();
    updateComponentTargets(false);
    applyComponentTargets();
    postPositions();
    restart(message.type === "update" ? 0.2 : 0.7);
  }
};

export {};
