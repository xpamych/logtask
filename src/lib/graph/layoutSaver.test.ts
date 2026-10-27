import test from "node:test";
import assert from "node:assert/strict";
import { createLayoutSaver } from "./layoutSaver.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("записи layout сериализуются, промежуточные состояния схлопываются", async () => {
  const first = deferred();
  const calls: number[] = [];
  const saver = createLayoutSaver("root", "global", async (_root, _scope, entries) => {
    calls.push(entries[0].x);
    if (calls.length === 1) await first.promise;
  });
  saver.schedule([{ id: "A", x: 1, y: 0, pinned: false }]);
  const flushing = saver.flush();
  saver.schedule([{ id: "A", x: 2, y: 0, pinned: false }]);
  saver.schedule([{ id: "A", x: 3, y: 0, pinned: false }]);
  const concurrent = saver.flush();
  first.resolve();
  await Promise.all([flushing, concurrent]);
  assert.deepEqual(calls, [1, 3]);
  saver.dispose();
});

test("flush отклоняется после ошибки записи и позволяет повторить сохранение", async (t) => {
  t.mock.method(console, "error", () => {});
  const calls: number[] = [];
  const saver = createLayoutSaver("root", "global", async (_root, _scope, entries) => {
    calls.push(entries[0].x);
    if (calls.length === 1) throw new Error("disk full");
  });
  saver.schedule([{ id: "A", x: 1, y: 0, pinned: false }]);
  await assert.rejects(saver.flush(), /disk full/);
  saver.schedule([{ id: "A", x: 2, y: 0, pinned: false }]);
  await saver.flush();
  assert.deepEqual(calls, [1, 2]);
  saver.dispose();
});
