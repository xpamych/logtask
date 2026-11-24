import type { BlockDto } from "./api";

export function blockCollectionKeyAllowed(editing: boolean): boolean {
  return !editing;
}

export function visibleBlockUuids(
  blocks: BlockDto[],
  collapsed: ReadonlySet<string>,
): string[] {
  const visible: string[] = [];
  let hiddenBelow: number | null = null;
  for (const block of blocks) {
    if (hiddenBelow !== null) {
      if (block.indent > hiddenBelow) continue;
      hiddenBelow = null;
    }
    visible.push(block.uuid);
    if (collapsed.has(block.uuid)) hiddenBelow = block.indent;
  }
  return visible;
}

export function toggleCollapsed(collapsed: ReadonlySet<string>, uuid: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(uuid)) next.delete(uuid);
  else next.add(uuid);
  return next;
}

export function hasBlockChildren(blocks: BlockDto[], uuid: string): boolean {
  const index = blocks.findIndex((block) => block.uuid === uuid);
  return index >= 0 && blocks[index + 1]?.indent > blocks[index].indent;
}
