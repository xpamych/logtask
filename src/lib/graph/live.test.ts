import test from "node:test";
import assert from "node:assert/strict";
import { LatestSnapshotLoader } from "./live.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("частые события дают один trailing и применяют только актуальный снимок", async () => {
  const first = deferred<number>();
  const second = deferred<number>();
  const calls: number[] = [];
  const applied: number[] = [];
  const loader = new LatestSnapshotLoader(() => {
    calls.push(calls.length + 1);
    return calls.length === 1 ? first.promise : second.promise;
  }, (value) => applied.push(value));
  loader.request();
  loader.request();
  loader.request();
  assert.equal(calls.length, 1);
  first.resolve(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  second.resolve(2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, [2]);
});

test("invalidate отбрасывает ответ предыдущего графа", async () => {
  const old = deferred<number>();
  const applied: number[] = [];
  const loader = new LatestSnapshotLoader(() => old.promise, (value) => applied.push(value));
  loader.request();
  loader.invalidate();
  old.resolve(42);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(applied, []);
});
