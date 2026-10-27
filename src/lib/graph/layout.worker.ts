import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { GraphViewSettings } from "~/lib/api";
import type { LayoutRequest } from "./layout";
import { componentTargets, connectedComponents, mergeLayout, normalizeMainComponent, packLayout, stablePosition, unpackLayout } from "./layout";

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

let components: string[][] = [];
let targets = new Map<string, { x: number; y: number }>();

function applyComponentTargets() {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const component of components) {
    const target = targets.get(component[0]);
    if (!target) continue;
    const members = component
      .map((id) => byId.get(id))
      .filter((node): node is WorkerNode => Boolean(node));
    if (members.length === 0) continue;
    const normalized = normalizeMainComponent(members, Math.max(12, Math.sqrt(members.length) * 5));
    const centerX = normalized.reduce((sum, node) => sum + (node.x ?? 0), 0) / normalized.length;
    const centerY = normalized.reduce((sum, node) => sum + (node.y ?? 0), 0) / normalized.length;
    for (const node of normalized) {
      node.x = (node.x ?? 0) + target.x - centerX;
      node.y = (node.y ?? 0) + target.y - centerY;
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
  simulation
    .force("charge", forceManyBody<WorkerNode>().strength(-settings.repelForce))
    .force(
      "link",
      forceLink<WorkerNode, SimulationLinkDatum<WorkerNode>>(links)
        .id((node) => node.id)
        .distance(settings.linkDistance)
        .strength(settings.linkForce),
    )
    .force("center", forceCenter<WorkerNode>(0, 0).strength(settings.centerForce));
  simulation.alphaDecay(settings.alphaDecay).randomSource(random);
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
    applyForces();
    components = connectedComponents(message.ids, message.edges ?? []);
    targets = componentTargets(message.ids, message.edges ?? []);
    applyComponentTargets();
    postPositions();
    restart(message.type === "update" ? 0.2 : 0.7);
  }
};

export {};
