import test from "node:test";
import assert from "node:assert/strict";
import { createLatestFrameScheduler } from "./dragScheduling.ts";

function harness() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const emitted: { x: number; y: number }[] = [];
  const scheduler = createLatestFrameScheduler({
    request: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id) => callbacks.delete(id),
    emit: (x, y) => emitted.push({ x, y }),
  });
  return {
    scheduler,
    emitted,
    fire: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pending: () => callbacks.size,
  };
}

test("события drag объединяются до последней точки одного кадра", () => {
  const frames = harness();
  for (let index = 0; index < 100; index += 1) frames.scheduler.schedule(index, index * 2);
  assert.equal(frames.pending(), 1);
  assert.deepEqual(frames.emitted, []);
  frames.fire();
  assert.deepEqual(frames.emitted, [{ x: 99, y: 198 }]);
  frames.fire();
  assert.deepEqual(frames.emitted, [{ x: 99, y: 198 }]);
  frames.scheduler.dispose();
});

test("flush немедленно передаёт последнюю точку перед завершением drag", () => {
  const frames = harness();
  frames.scheduler.schedule(10, 20);
  frames.scheduler.schedule(30, 40);
  frames.scheduler.flush();
  assert.equal(frames.pending(), 0);
  assert.deepEqual(frames.emitted, [{ x: 30, y: 40 }]);
  frames.scheduler.flush();
  assert.deepEqual(frames.emitted, [{ x: 30, y: 40 }]);
  frames.scheduler.dispose();
});

test("dispose отменяет кадр и запрещает запоздалый emit", () => {
  const frames = harness();
  frames.scheduler.schedule(10, 20);
  frames.scheduler.dispose();
  assert.equal(frames.pending(), 0);
  frames.scheduler.schedule(30, 40);
  frames.scheduler.flush();
  assert.deepEqual(frames.emitted, []);
});
