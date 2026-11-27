import type { PageTreeDto } from "./api";

export interface PageTreeNode {
  kind: "directory" | "page";
  name: string;
  path: string;
  children: PageTreeNode[];
}

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const storagePrefix = "logtask:expanded-pages:";
const maxExpandedDirs = 500;

export function pageNameStem(name: string): string {
  return name.split("/").at(-1) ?? name;
}

export function buildPageTree(data: PageTreeDto, graphName: string): PageTreeNode {
  const root: PageTreeNode = { kind: "directory", name: graphName, path: graphName, children: [] };
  const directories = new Map<string, PageTreeNode>([[graphName, root]]);
  const ensureDirectory = (path: string): PageTreeNode => {
    const existing = directories.get(path);
    if (existing) return existing;
    const parentPath = path.split("/").slice(0, -1).join("/");
    const node: PageTreeNode = {
      kind: "directory",
      name: path.split("/").at(-1) ?? path,
      path,
      children: [],
    };
    directories.set(path, node);
    ensureDirectory(parentPath).children.push(node);
    return node;
  };

  for (const local of data.directories) ensureDirectory(`${graphName}/${local}`);
  for (const path of data.pages) {
    const parentPath = path.split("/").slice(0, -1).join("/");
    ensureDirectory(parentPath).children.push({
      kind: "page",
      name: path.split("/").at(-1) ?? path,
      path,
      children: [],
    });
  }

  const sort = (node: PageTreeNode) => {
    node.children.sort((a, b) =>
      a.kind === b.kind
        ? collator.compare(a.name, b.name)
        : a.kind === "directory" ? -1 : 1,
    );
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function readExpandedDirs(storage: Storage, root: string, defaultExpanded?: string): Set<string> {
  try {
    const stored = storage.getItem(`${storagePrefix}${root}`);
    if (stored === null) return new Set(defaultExpanded ? [defaultExpanded] : []);
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value)) return new Set();
    const expanded = new Set(value.filter((item): item is string => typeof item === "string").slice(0, maxExpandedDirs));
    if (defaultExpanded) expanded.add(defaultExpanded);
    return expanded;
  } catch {
    return new Set();
  }
}

export function writeExpandedDirs(storage: Storage, root: string, paths: Set<string>): void {
  try {
    storage.setItem(`${storagePrefix}${root}`, JSON.stringify([...paths].slice(0, maxExpandedDirs)));
  } catch {
    // Приватный режим или переполненное хранилище не должны ломать дерево.
  }
}

export function revealPath(expanded: Set<string>, directory: string): Set<string> {
  const parts = directory.split("/");
  for (let length = 1; length <= parts.length; length += 1) {
    expanded.add(parts.slice(0, length).join("/"));
  }
  return expanded;
}
