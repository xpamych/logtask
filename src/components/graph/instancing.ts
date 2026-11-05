import type { InstanceBatch } from "./geometry.ts";

export function circleTriangleFan(segments: number): Float32Array {
  const vertices = new Float32Array((segments + 2) * 2);
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    vertices[(index + 1) * 2] = Math.cos(angle);
    vertices[(index + 1) * 2 + 1] = Math.sin(angle);
  }
  return vertices;
}

export function lineQuad(): Float32Array {
  return new Float32Array([0,-1, 0,1, 1,-1, 1,-1, 0,1, 1,1]);
}

export function arrowTriangle(): Float32Array {
  return new Float32Array([0,0, -1,0.6, -1,-0.6]);
}

export function selfLinkTriangles(segments = 12): Float32Array {
  const vertices: number[] = [];
  const vertex = (x: number, y: number, offsetX: number, offsetY: number) => {
    vertices.push(x, y, offsetX, offsetY);
  };
  const triangle = (
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    offsetAX: number, offsetAY: number, offsetBX: number, offsetBY: number,
    offsetCX: number, offsetCY: number,
  ) => {
    vertex(ax, ay, offsetAX, offsetAY);
    vertex(bx, by, offsetBX, offsetBY);
    vertex(cx, cy, offsetCX, offsetCY);
  };
  for (let segment = 0; segment < segments; segment += 1) {
    const a = segment / segments * Math.PI * 2;
    const b = (segment + 1) / segments * Math.PI * 2;
    const ax = Math.cos(a) * 16;
    const ay = Math.sin(a) * 16;
    const bx = Math.cos(b) * 16;
    const by = Math.sin(b) * 16;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    const ox = -dy / length * 0.35;
    const oy = dx / length * 0.35;
    triangle(ax, ay, bx, by, ax, ay, ox, oy, -ox, -oy, ox, oy);
    triangle(ax, ay, bx, by, bx, by, -ox, -oy, ox, oy, -ox, -oy);
  }
  return new Float32Array(vertices);
}

export function nodeSegments(radius: number, zoom: number): 16 | 64 {
  return radius * zoom >= 12 ? 64 : 16;
}

export const LINE_INSTANCE_STRIDE = 36;

export function pushLineInstance(
  batch: InstanceBatch,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rgba: readonly [number, number, number, number],
  width: number,
): boolean {
  if (Math.hypot(bx - ax, by - ay) < 0.0001) return false;
  batch.push(ax, ay, bx, by, ...rgba, width);
  return true;
}
