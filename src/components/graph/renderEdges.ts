import type { GraphEdgeDto } from "~/lib/api";
import type { SceneNode } from "~/lib/graph/model";

export function indexSceneNodes(nodes: SceneNode[]): Map<string, SceneNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function graphLabelScale(zoom: number, hovered: boolean): number {
  if (hovered && zoom < 1) return 1;
  return Math.sqrt(zoom);
}

export function graphLabelYOffset(radius: number, zoom: number, hovered: boolean): number {
  return (radius + 5) * Math.sqrt(zoom) + (hovered ? 15 : 0);
}

export function nodeLabelOpacity(
  _nodeCount: number,
  zoom: number,
  threshold: number,
  priority: boolean,
): number {
  if (priority) return 1;
  if (zoom <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log2(zoom) + 1 - threshold));
}

export type GraphNodeRole = "hovered" | "highlighted" | "muted" | "normal";

export function graphNodeRole(
  id: string,
  hovered: string | null,
  highlighted: Set<string>,
): GraphNodeRole {
  if (id === hovered) return "hovered";
  if (highlighted.has(id)) return "highlighted";
  if (highlighted.size > 0) return "muted";
  return "normal";
}

export function isEdgeHighlighted(source: string, target: string, highlighted: ReadonlySet<string>): boolean {
  return highlighted.size > 0 && highlighted.has(source) && highlighted.has(target);
}

export function graphNodeRadius(
  node: Pick<SceneNode, "degree" | "clusterMembers">,
  nodeScale = 1,
): number {
  const radius = Math.max(8, Math.min(3 * Math.sqrt(Math.max(0, node.degree) + 1), 30));
  return (radius + (node.clusterMembers ? 4 : 0)) * nodeScale;
}

export function graphNodeLabelOpacity(
  role: GraphNodeRole,
  nodeCount: number,
  zoom: number,
  threshold: number,
): number {
  return nodeLabelOpacity(nodeCount, zoom, threshold, role !== "normal");
}

export function graphNodeFinalLabelOpacity(
  role: GraphNodeRole,
  nodeCount: number,
  zoom: number,
  threshold: number,
  nodeAlpha: number,
): number {
  if (role === "muted") return 0;
  return graphNodeLabelOpacity(role, nodeCount, zoom, threshold) * nodeAlpha;
}

export interface RenderEdge {
  source: string;
  target: string;
  weight: number;
  forward: boolean;
  backward: boolean;
}

export function mergeRenderEdges(edges: GraphEdgeDto[]): RenderEdge[] {
  const merged = new Map<string, RenderEdge>();
  for (const edge of edges) {
    const [source, target] = edge.source <= edge.target
      ? [edge.source, edge.target]
      : [edge.target, edge.source];
    const key = `${source}->${target}`;
    const current = merged.get(key) ?? {
      source,
      target,
      weight: 0,
      forward: false,
      backward: false,
    };
    current.weight += edge.weight;
    if (edge.source === source) current.forward = true;
    else current.backward = true;
    merged.set(key, current);
  }
  return [...merged.values()];
}

export function createRenderEdgeCache() {
  let source: GraphEdgeDto[] | null = null;
  let cached: RenderEdge[] = [];
  return (edges: GraphEdgeDto[]): RenderEdge[] => {
    if (edges !== source) {
      source = edges;
      cached = mergeRenderEdges(edges);
    }
    return cached;
  };
}
