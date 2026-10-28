import type { GraphEdgeDto } from "~/lib/api";
import type { SceneNode } from "~/lib/graph/model";

export function indexSceneNodes(nodes: SceneNode[]): Map<string, SceneNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function nodeLabelOpacity(
  nodeCount: number,
  zoom: number,
  threshold: number,
  priority: boolean,
): number {
  if (priority) return 1;
  if (nodeCount > 100 && zoom < 1.5) return 0;
  return Math.max(0, Math.min(1, (zoom - threshold) / 0.5));
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

export function graphNodeRadius(
  node: Pick<SceneNode, "degree" | "clusterMembers">,
  nodeScale = 1,
): number {
  return (3 + Math.sqrt(node.degree) * 1.2 + (node.clusterMembers ? 4 : 0)) * nodeScale;
}

export function graphNodeLabelOpacity(
  role: GraphNodeRole,
  nodeCount: number,
  zoom: number,
  threshold: number,
): number {
  if (role === "muted") return 0;
  return nodeLabelOpacity(nodeCount, zoom, threshold, role !== "normal");
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
