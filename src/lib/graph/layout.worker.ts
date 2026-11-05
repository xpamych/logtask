import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { GraphViewSettings } from "~/lib/api";
import { nextDragAlpha } from "./dragAlpha.ts";
import type { LayoutRequest } from "./layout.ts";
import { initialNodePositions, stablePosition, unpackLayout } from "./layout.ts";

interface WorkerNode extends SimulationNodeDatum {
  id: string;
}

type WorkerLink = SimulationLinkDatum<WorkerNode>;

export function configureObsidianSimulation(
  simulation: Simulation<WorkerNode, undefined>,
  links: WorkerLink[],
  settings: GraphViewSettings,
): void {
  const degrees = new Map(simulation.nodes().map((node) => [node.id, 0]));
  const endpointId = (endpoint: string | number | WorkerNode) =>
    typeof endpoint === "object" ? endpoint.id : String(endpoint);
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    degrees.set(source, (degrees.get(source) ?? 0) + 1);
    degrees.set(target, (degrees.get(target) ?? 0) + 1);
  }
  const repel = Math.abs(settings.repelForce) < 1 ? 1 : settings.repelForce;
  simulation
    .force("x", forceX<WorkerNode>(0).strength(settings.centerForce))
    .force("y", forceY<WorkerNode>(0).strength(settings.centerForce))
    .force("charge", forceManyBody<WorkerNode>().strength(-repel).distanceMin(30).theta(0.9))
    .force("collide", forceCollide<WorkerNode>(60).strength(0.5))
    .force("link", forceLink<WorkerNode, WorkerLink>(links)
      .id((node) => node.id)
      .distance(settings.linkDistance)
      .strength((link) => {
        const source = link.source as WorkerNode;
        const target = link.target as WorkerNode;
        return settings.linkForce / Math.max(1, Math.min(degrees.get(source.id) ?? 0, degrees.get(target.id) ?? 0));
      }))
    .velocityDecay(0.4)
    .alphaDecay(settings.alphaDecay);
}

let simulation: Simulation<WorkerNode, undefined> | null = null;
let nodes: WorkerNode[] = [];
let links: WorkerLink[] = [];
let settings: GraphViewSettings | null = null;
let generation = 0;
let paused = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let nodeIds: string[] = [];

function postPositions() {
  const positions = {
    xy: new Float32Array(nodes.length * 2),
    pinned: new Uint8Array(nodes.length),
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    positions.xy[index * 2] = Number.isFinite(node.x) ? node.x! : stablePosition(node.id).x;
    positions.xy[index * 2 + 1] = Number.isFinite(node.y) ? node.y! : stablePosition(node.id).y;
    positions.pinned[index] = node.fx !== undefined && node.fx !== null ? 1 : 0;
  }
  (self as unknown as {
    postMessage: (message: unknown, transfer: Transferable[]) => void;
  }).postMessage(
    { type: "positions", generation, ids: nodeIds, positions },
    [positions.xy.buffer, positions.pinned.buffer],
  );
}

function tick() {
  if (!simulation || paused) return;
  simulation.tick();
  postPositions();
  if (simulation.alpha() < simulation.alphaMin()) {
    self.postMessage({ type: "settled", generation });
    return;
  }
  timer = setTimeout(tick, settings?.qualityTickMs ?? 16);
}

function restart(alpha = 0.3) {
  clearTimeout(timer);
  if (!simulation) return;
  if (alpha === 0) simulation.alpha(0);
  else if (simulation.alpha() < alpha) simulation.alpha(alpha);
  if (alpha === 0 && simulation.alphaTarget() === 0) {
    if (!paused) self.postMessage({ type: "settled", generation });
    return;
  }
  if (paused) return;
  simulation.restart();
  simulation.stop();
  timer = setTimeout(tick, 0);
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
    if (!simulation) return;
    if (simulation.alpha() >= simulation.alphaMin()) restart();
    else self.postMessage({ type: "settled", generation });
    return;
  }
  if (message.type === "params" && message.settings) {
    settings = message.settings;
    if (simulation) configureObsidianSimulation(simulation, links, settings);
    restart(0.3);
    return;
  }
  if (message.type === "drag" && message.id && message.x !== undefined && message.y !== undefined) {
    const node = nodes.find((candidate) => candidate.id === message.id);
    if (node && simulation) {
      node.x = message.x;
      node.y = message.y;
      node.fx = message.pinned ? message.x : undefined;
      node.fy = message.pinned ? message.y : undefined;
      if (message.alphaTarget !== undefined) simulation.alphaTarget(message.alphaTarget);
      postPositions();
      restart(nextDragAlpha(simulation.alpha(), simulation.alphaMin(), 0.3));
    }
    return;
  }
  if ((message.type === "init" || message.type === "update") && message.ids && message.settings) {
    settings = message.settings;
    const positions = message.positions
      ? unpackLayout(message.ids, message.positions)
      : initialNodePositions(message.ids, message.edges ?? [], []);
    nodes = positions.map((position) => ({
      id: position.id,
      x: position.x,
      y: position.y,
      fx: position.pinned ? position.x : undefined,
      fy: position.pinned ? position.y : undefined,
    }));
    links = (message.edges ?? []).map((edge) => ({ ...edge }));
    simulation?.stop();
    simulation = forceSimulation(nodes).stop().alphaTarget(0);
    configureObsidianSimulation(simulation, links, settings);
    nodeIds = [...message.ids];
    postPositions();
    restart(message.alpha ?? 0.3);
  }
};

export {};
