import test from "node:test";
import assert from "node:assert/strict";
import { InstanceBatch } from "./geometry.ts";
import { arrowTriangle, circleTriangleFan, LINE_INSTANCE_STRIDE, lineQuad, nodeSegments, pushLineInstance, selfLinkTriangles } from "./instancing.ts";

test("InstanceBatch растёт и сохраняет порядок динамических данных", () => {
  const batch = new InstanceBatch(12);
  batch.push(1, 2, 3, 4, 5, 6);
  batch.push(7, 8, 9, 10, 11, 12);
  batch.push(13, 14, 15, 16, 17, 18);
  assert.equal(batch.count, 3);
  assert.deepEqual([...batch.values()], [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
  batch.clear();
  assert.equal(batch.count, 0);
  assert.deepEqual([...batch.values()], []);
});

test("шаблоны круга повторяют 16 и 64 сегмента старой геометрии", () => {
  for (const segments of [16, 64]) {
    const template = circleTriangleFan(segments);
    assert.equal(template.length, (segments + 2) * 2);
    assert.deepEqual([...template.slice(0, 2)], [0, 0]);
    assert.deepEqual([...template.slice(2, 4)], [1, 0]);
    assert(Math.abs(template.at(-2)! - 1) < 1e-6);
    assert(Math.abs(template.at(-1)!) < 1e-6);
  }
  assert.equal(nodeSegments(6, 1), 16);
  assert.equal(nodeSegments(6, 2), 64);
});

test("линия и стрелка используют статические GPU-шаблоны", () => {
  assert.deepEqual([...lineQuad()], [0,-1, 0,1, 1,-1, 1,-1, 0,1, 1,1]);
  const arrow = arrowTriangle();
  assert.deepEqual([...arrow.slice(0, 3)], [0, 0, -1]);
  assert(Math.abs(arrow[3] - 0.6) < 1e-6);
  assert.deepEqual([...arrow.slice(4, 5)], [-1]);
  assert(Math.abs(arrow[5] + 0.6) < 1e-6);
});

test("self-link сохраняет 12 сегментов с radius 16 и width 0.35", () => {
  const template = selfLinkTriangles();
  assert.equal(template.length, 12 * 6 * 4);
  const dx = Math.cos(Math.PI / 6) * 16 - 16;
  const dy = Math.sin(Math.PI / 6) * 16;
  const length = Math.hypot(dx, dy);
  const offsetX = -dy / length * 0.35;
  const offsetY = dx / length * 0.35;
  const expected = [16, 0, offsetX, offsetY];
  for (let index = 0; index < expected.length; index += 1) {
    assert(Math.abs(template[index] - expected[index]) < 1e-6);
  }
});

test("нулевая линия не попадает в instance buffer", () => {
  const batch = new InstanceBatch();
  assert.equal(pushLineInstance(batch, 1, 1, 1, 1, [1, 1, 1, 1], 0.35), false);
  assert.equal(batch.count, 0);
  assert.equal(pushLineInstance(batch, 0, 0, 2, 0, [1, 0.5, 0.25, 1], 0.35), true);
  assert.equal(batch.count, 1);
  const values = batch.values();
  assert.deepEqual([...values.slice(0, 8)], [0,0, 2,0, 1,0.5,0.25,1]);
  assert(Math.abs(values[8] - 0.35) < 1e-6);
  assert.equal(values.byteLength, LINE_INSTANCE_STRIDE);
});
