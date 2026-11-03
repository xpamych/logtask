import assert from "node:assert/strict";
import test from "node:test";
import { GeometryBatch } from "./geometry.ts";

test("буфер геометрии растёт и сохраняет вершины между кадрами", () => {
  const batch = new GeometryBatch(12);
  batch.vertex(1, 2, 3, 4, 5, 6);
  batch.vertex(7, 8, 9, 10, 11, 12);
  batch.vertex(13, 14, 15, 16, 17, 18);
  assert.deepEqual([...batch.values()], [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]);
  assert.equal(batch.vertexCount, 3);
  batch.clear();
  assert.equal(batch.vertexCount, 0);
  batch.vertex(20, 21, 22, 23, 24, 25);
  assert.deepEqual([...batch.values()], [20,21,22,23,24,25]);
});
