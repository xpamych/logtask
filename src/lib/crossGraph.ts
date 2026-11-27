import type { RecentGraph } from "./api";

export interface CrossGraphTarget {
  graphName: string;
  localName: string;
}

export type CrossGraphResolution =
  | { kind: "local"; name: string }
  | { kind: "switch"; path: string; name: string; graphName: string }
  | { kind: "unknown"; graphName: string; name: string }
  | { kind: "ambiguous"; graphName: string };

export function graphBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function canonicalRenameTarget(currentRoot: string, newName: string): string {
  const graphName = graphBaseName(currentRoot);
  return newName.startsWith(`${graphName}/`) ? newName : `${graphName}/${newName}`;
}

export function parseCrossGraphTarget(
  target: string,
  _currentGraphName: string,
): CrossGraphTarget | null {
  const separator = target.indexOf("/");
  if (separator <= 0 || separator === target.length - 1) return null;
  return {
    graphName: target.slice(0, separator),
    localName: target.slice(separator + 1),
  };
}

export function resolveCrossGraphTarget(
  target: string,
  currentRoot: string,
  currentPages: string[],
  recents: RecentGraph[],
): CrossGraphResolution {
  const currentGraphName = graphBaseName(currentRoot);
  if (currentPages.includes(target) || currentPages.includes(`${currentGraphName}/${target}`)) {
    return { kind: "local", name: target };
  }
  const parsed = parseCrossGraphTarget(target, currentGraphName);
  if (!parsed || parsed.graphName === currentGraphName) return { kind: "local", name: target };
  const matches = recents.filter((recent) => graphBaseName(recent.path) === parsed.graphName);
  if (matches.length > 1) return { kind: "ambiguous", graphName: parsed.graphName };
  if (matches.length === 1) {
    return {
      kind: "switch",
      path: matches[0].path,
      name: target,
      graphName: parsed.graphName,
    };
  }
  return { kind: "unknown", graphName: parsed.graphName, name: target };
}
