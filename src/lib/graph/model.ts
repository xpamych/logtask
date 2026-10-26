import type {
  GraphColorGroup,
  GraphEdgeDto,
  GraphNodeDto,
  GraphSnapshotDto,
  GraphViewSettings,
} from "~/lib/api";

export interface SceneNode extends GraphNodeDto {
  clusterMembers?: string[];
}

export interface SceneGraph {
  nodes: SceneNode[];
  edges: GraphEdgeDto[];
  revision: number;
}

const fold = (value: string) => value.toLocaleLowerCase("ru");

export function matchesGraphQuery(node: GraphNodeDto, query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean).map(fold);
  return words.every((word) => {
    const [prefix, ...rest] = word.split(":");
    const value = rest.join(":");
    if (rest.length > 0 && ["tag", "name", "path", "kind"].includes(prefix)) {
      if (prefix === "tag") {
        return node.tags.some((tag) => fold(tag).includes(value)) ||
          (node.kind === "tag" && fold(node.title).includes(value));
      }
      if (prefix === "name") return fold(node.title).includes(value);
      if (prefix === "path") return fold(node.path ?? "").includes(value);
      return fold(node.kind) === value;
    }
    return [node.title, node.path ?? "", ...node.tags].some((text) =>
      fold(text).includes(word),
    );
  });
}

function globMatch(pattern: string, node: GraphNodeDto): boolean {
  const escaped = fold(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const regex = new RegExp(`^${escaped}$`, "u");
  return regex.test(fold(node.title)) || regex.test(fold(node.path ?? "")) ||
    regex.test(fold(node.id));
}

function withDegrees(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  revision: number,
): GraphSnapshotDto {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  return {
    nodes: nodes.map((node) => ({ ...node, degree: neighbors.get(node.id)?.size ?? 0 })),
    edges,
    revision,
  };
}

export function filterGraph(
  snapshot: GraphSnapshotDto,
  settings: GraphViewSettings,
): GraphSnapshotDto {
  const nodes = snapshot.nodes.filter((node) => {
    if (node.kind === "journal" && !settings.showJournals) return false;
    if (node.kind === "tag" && (!settings.showTags || settings.onlyExisting)) return false;
    if (node.kind === "virtual" && settings.onlyExisting) return false;
    if (node.kind === "asset" && !settings.showAssets) return false;
    if (!matchesGraphQuery(node, settings.search)) return false;
    return !settings.exclusions.some((pattern) => globMatch(pattern, node));
  });
  const visible = new Set(nodes.map((node) => node.id));
  const edges = snapshot.edges.filter(
    (edge) => visible.has(edge.source) && visible.has(edge.target),
  );
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const filtered = settings.hideOrphans
    ? nodes.filter((node) => connected.has(node.id))
    : nodes;
  return withDegrees(filtered, edges, snapshot.revision);
}

export function colorForNode(node: GraphNodeDto, groups: GraphColorGroup[]): string | null {
  return groups.find((group) => group.enabled && matchesGraphQuery(node, group.query))?.color ?? null;
}

function journalPeriod(id: string, aggregation: string): string | null {
  const match = /^journal:(\d{4})_(\d{2})_\d{2}$/.exec(id);
  if (!match) return null;
  return aggregation === "year" ? match[1] : `${match[1]}_${match[2]}`;
}

export function clusterGraph(
  snapshot: GraphSnapshotDto,
  settings: GraphViewSettings,
  expanded: ReadonlySet<string>,
): SceneGraph {
  const membership = new Map<string, string>();
  const members = new Map<string, string[]>();
  const addToCluster = (node: GraphNodeDto, id: string) => {
    if (expanded.has(id) || membership.has(node.id)) return;
    membership.set(node.id, id);
    members.set(id, [...(members.get(id) ?? []), node.id]);
  };

  for (const node of snapshot.nodes) {
    const group = settings.groups.find(
      (candidate) => candidate.enabled && candidate.clustered && matchesGraphQuery(node, candidate.query),
    );
    if (group) addToCluster(node, `cluster:group:${group.id}`);
  }

  const journalGroups = new Map<string, GraphNodeDto[]>();
  for (const node of snapshot.nodes) {
    if (node.kind !== "journal" || membership.has(node.id)) continue;
    const period = journalPeriod(node.id, settings.journalAggregation);
    if (!period) continue;
    journalGroups.set(period, [...(journalGroups.get(period) ?? []), node]);
  }
  for (const [period, nodes] of journalGroups) {
    if (nodes.length < settings.clusterThreshold) continue;
    for (const node of nodes) {
      addToCluster(node, `cluster:journal:${settings.journalAggregation}:${period}`);
    }
  }

  const nodes: SceneNode[] = [];
  for (const node of snapshot.nodes) {
    if (!membership.has(node.id)) nodes.push({ ...node });
  }
  for (const [id, clusterMembers] of members) {
    const groupId = id.startsWith("cluster:group:") ? id.slice("cluster:group:".length) : null;
    const group = settings.groups.find((candidate) => candidate.id === groupId);
    const period = id.split(":").at(-1) ?? "";
    nodes.push({
      id,
      title: group?.query ?? `Журналы: ${period.replace("_", "-")}`,
      kind: "cluster",
      path: null,
      tags: [],
      degree: 0,
      assetPath: null,
      exists: true,
      clusterMembers,
    });
  }

  const edgeWeights = new Map<string, GraphEdgeDto>();
  for (const edge of snapshot.edges) {
    const source = membership.get(edge.source) ?? edge.source;
    const target = membership.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    const current = edgeWeights.get(key);
    edgeWeights.set(key, {
      id: key,
      source,
      target,
      weight: (current?.weight ?? 0) + edge.weight,
    });
  }
  const result = withDegrees(nodes, [...edgeWeights.values()], snapshot.revision);
  return result as SceneGraph;
}

export function projectPathToClusters(path: string[], scene: SceneGraph): string[] {
  const clusters = new Map<string, string>();
  for (const node of scene.nodes) {
    for (const member of node.clusterMembers ?? []) clusters.set(member, node.id);
  }
  return path.reduce<string[]>((result, id) => {
    const projected = clusters.get(id) ?? id;
    if (result.at(-1) !== projected) result.push(projected);
    return result;
  }, []);
}

export function shortestVisiblePath(
  snapshot: GraphSnapshotDto,
  from: string,
  to: string,
): string[] | null {
  const visible = new Set(snapshot.nodes.map((node) => node.id));
  if (!visible.has(from) || !visible.has(to)) return null;
  if (from === to) return [from];
  const adjacency = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  const queue = [from];
  const previous = new Map<string, string>();
  const visited = new Set([from]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of [...(adjacency.get(current) ?? [])].sort()) {
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        let cursor = to;
        while (cursor !== from) {
          cursor = previous.get(cursor)!;
          path.push(cursor);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
