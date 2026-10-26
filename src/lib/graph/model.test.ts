import test from "node:test";
import assert from "node:assert/strict";
import type { GraphNodeDto, GraphSnapshotDto } from "~/lib/api";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import {
  clusterGraph,
  colorForNode,
  filterGraph,
  matchesGraphQuery,
  projectPathToClusters,
  shortestVisiblePath,
} from "./model.ts";

function node(id: string, kind: GraphNodeDto["kind"], tags: string[] = []): GraphNodeDto {
  return {
    id,
    title: id.split(":").slice(1).join(":"),
    kind,
    path: kind === "page" ? `pages/${id.slice(5)}.md` : null,
    tags,
    degree: 0,
    assetPath: kind === "asset" ? id.slice(6) : null,
    exists: kind !== "virtual" && kind !== "tag",
  };
}

function fixture(): GraphSnapshotDto {
  const nodes = [
    node("page:A", "page", ["active"]),
    node("page:B", "page", ["active"]),
    node("page:Orphan", "page"),
    node("journal:2026_10_26", "journal"),
    node("tag:ideas", "tag"),
    node("virtual:Ghost", "virtual"),
    node("asset:assets/a.png", "asset"),
  ];
  return {
    nodes,
    edges: [
      { id: "ab", source: "page:A", target: "page:B", weight: 1 },
      { id: "ja", source: "journal:2026_10_26", target: "page:A", weight: 1 },
      { id: "ta", source: "tag:ideas", target: "page:A", weight: 1 },
      { id: "ga", source: "virtual:Ghost", target: "page:A", weight: 1 },
      { id: "aa", source: "asset:assets/a.png", target: "page:A", weight: 1 },
    ],
    revision: 1,
  };
}

test("defaults показывают обычные страницы, включая сирот", () => {
  const result = filterGraph(fixture(), DEFAULT_GRAPH_VIEW_SETTINGS);
  assert.deepEqual(result.nodes.map((n) => n.id), ["page:A", "page:B", "page:Orphan"]);
  assert.equal(result.edges.length, 1);
});

test("фильтры применяются до hideOrphans и не мутируют snapshot", () => {
  const original = structuredClone(fixture());
  const settings = {
    ...DEFAULT_GRAPH_VIEW_SETTINGS,
    showJournals: true,
    showTags: true,
    showAssets: true,
    onlyExisting: false,
    hideOrphans: true,
    exclusions: ["Orphan"],
  };
  const result = filterGraph(fixture(), settings);
  assert.equal(result.nodes.some((n) => n.id === "page:Orphan"), false);
  assert.equal(result.nodes.length, 6);
  assert.deepEqual(fixture(), original);
});

test("поиск понимает поля и объединяет слова через И", () => {
  const a = fixture().nodes[0];
  assert.equal(matchesGraphQuery(a, "tag:active name:A"), true);
  assert.equal(matchesGraphQuery(a, "name:A"), true);
  assert.equal(matchesGraphQuery(a, "path:pages/A.md"), true);
  assert.equal(matchesGraphQuery(a, "kind:page"), true);
  assert.equal(matchesGraphQuery(a, "tag:missing"), false);
});

test("первая цветовая группа побеждает", () => {
  const groups = [
    { id: "first", query: "tag:active", color: "#111111", enabled: true, clustered: false },
    { id: "second", query: "name:A", color: "#222222", enabled: true, clustered: false },
  ];
  assert.equal(colorForNode(fixture().nodes[0], groups), "#111111");
});

test("кластеры не вкладываются и сохраняют внешние рёбра", () => {
  const settings = {
    ...DEFAULT_GRAPH_VIEW_SETTINGS,
    showJournals: true,
    showTags: true,
    showAssets: true,
    onlyExisting: false,
    clusterThreshold: 1,
    groups: [
      { id: "active", query: "tag:active", color: "#111111", enabled: true, clustered: true },
    ],
  };
  const scene = clusterGraph(filterGraph(fixture(), settings), settings, new Set());
  const cluster = scene.nodes.find((n) => n.id === "cluster:group:active");
  assert.deepEqual(cluster?.clusterMembers, ["page:A", "page:B"]);
  assert.equal(scene.nodes.filter((n) => n.clusterMembers?.includes("page:A")).length, 1);
  assert(scene.nodes.some((n) => n.id === "cluster:journal:month:2026_10"));
  assert.equal(scene.edges.some((e) => e.source === "page:A" || e.target === "page:A"), false);
  assert(scene.edges.some((e) => e.id.includes("cluster:group:active") && e.id.includes("cluster:journal")));
  assert.deepEqual(projectPathToClusters(["page:A", "journal:2026_10_26"], scene), [
    "cluster:group:active",
    "cluster:journal:month:2026_10",
  ]);
});

test("BFS игнорирует направление и возвращает отсутствие пути", () => {
  const snapshot = filterGraph(fixture(), DEFAULT_GRAPH_VIEW_SETTINGS);
  assert.deepEqual(shortestVisiblePath(snapshot, "page:B", "page:A"), ["page:B", "page:A"]);
  assert.equal(shortestVisiblePath(snapshot, "page:A", "page:Orphan"), null);
});
