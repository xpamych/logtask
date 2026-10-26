import type { GraphSnapshotDto } from "~/lib/api";
import { shortestVisiblePath } from "./model.ts";

export interface GraphSelection {
  first: string;
  second: string | null;
  path: string[] | null;
  message: string | null;
}

export function selectGraphNode(
  current: GraphSelection | null,
  id: string,
  snapshot: GraphSnapshotDto,
): GraphSelection | null {
  if (current?.second) return { first: id, second: null, path: null, message: null };
  if (!current) return { first: id, second: null, path: null, message: null };
  if (current.first === id) return null;
  const path = shortestVisiblePath(snapshot, current.first, id);
  return {
    first: current.first,
    second: id,
    path,
    message: path ? `Путь: ${path.length - 1} ${path.length === 2 ? "переход" : "перехода"}` : "Путь не найден",
  };
}

export function selectionHighlight(
  selection: GraphSelection | null,
  snapshot: GraphSnapshotDto,
): Set<string> {
  if (!selection) return new Set();
  if (selection.path) return new Set(selection.path);
  if (selection.second) return new Set([selection.first, selection.second]);
  const result = new Set([selection.first]);
  for (const edge of snapshot.edges) {
    if (edge.source === selection.first) result.add(edge.target);
    if (edge.target === selection.first) result.add(edge.source);
  }
  return result;
}

export function refreshGraphSelection(
  selection: GraphSelection | null,
  snapshot: GraphSnapshotDto,
): GraphSelection | null {
  if (!selection) return null;
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  if (!ids.has(selection.first) || (selection.second && !ids.has(selection.second))) return null;
  if (!selection.second) return { ...selection, path: null, message: null };
  const path = shortestVisiblePath(snapshot, selection.first, selection.second);
  return {
    ...selection,
    path,
    message: path ? `Путь: ${path.length - 1} ${path.length === 2 ? "переход" : "перехода"}` : "Путь не найден",
  };
}

export function nextGraphFocusIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}
