import type { GraphEdgeDto } from "~/lib/api";
import type { SceneNode } from "~/lib/graph/model";

export function indexSceneNodes(nodes: SceneNode[]): Map<string, SceneNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function shouldShowNodeLabel(
  nodeCount: number,
  zoom: number,
  threshold: number,
  priority: boolean,
): boolean {
  if (priority) return true;
  if (nodeCount > 100 && zoom < 1.5) return false;
  return zoom >= threshold;
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
