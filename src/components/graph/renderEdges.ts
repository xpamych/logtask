import type { GraphEdgeDto } from "~/lib/api";

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
