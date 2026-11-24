export function blockParentUuids(blocks: { uuid: string; indent: number }[]): Record<string, string> {
  const parents: Record<string, string> = {};
  const stack: string[] = [];
  for (const block of blocks) {
    if (block.indent > 0 && stack[block.indent - 1]) {
      parents[block.uuid] = stack[block.indent - 1];
    }
    stack[block.indent] = block.uuid;
    stack.length = block.indent + 1;
  }
  return parents;
}

export interface CirclePoint {
  x: number;
  y: number;
  radius: number;
}

export function treeLinkPath(parent: CirclePoint, child: CirclePoint): string {
  const startY = parent.y + parent.radius;
  const centerY = child.y;
  const endX = child.x - child.radius;
  const corner = Math.min(12, Math.max(0, (endX - parent.x) / 2));
  return `M${parent.x} ${startY} V${centerY - corner} Q${parent.x} ${centerY} ${parent.x + corner} ${centerY} H${endX}`;
}
