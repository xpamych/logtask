import assert from "node:assert/strict";
import test from "node:test";
import { SettingsWriteQueue } from "./settingsQueue.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("settings_queue_serializes_requests", async () => {
  const first = deferred();
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const queue = new SettingsWriteQueue<string>(async (value) => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(value);
    if (value === "A1") await first.promise;
    active--;
  });
  queue.setGraph("A");
  queue.enqueue("A", "A1");
  queue.enqueue("A", "A2");
  first.resolve();
  await queue.idle();

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["A1", "A2"]);
});

test("latest_pending_wins", async () => {
  const first = deferred();
  const saved: string[] = [];
  const queue = new SettingsWriteQueue<string>(async (value) => {
    if (value === "A1") await first.promise;
    saved.push(value);
  });
  queue.setGraph("A");
  queue.enqueue("A", "A1");
  queue.enqueue("A", "A2");
  queue.enqueue("A", "A3");
  first.resolve();
  await queue.idle();

  assert.deepEqual(saved, ["A1", "A3"]);
});

test("old_graph_never_saves_into_new_graph", async () => {
  const first = deferred();
  const roots: string[] = [];
  const queue = new SettingsWriteQueue<string>(async (_value, root) => {
    roots.push(root);
    if (root === "A") await first.promise;
  });
  queue.setGraph("A");
  queue.enqueue("A", "A1");
  queue.enqueue("A", "A2");
  queue.setGraph("B");
  queue.enqueue("B", "B1");
  first.resolve();
  await queue.idle();

  assert.deepEqual(roots, ["A", "B"]);
  assert.equal(queue.pendingSnapshot(), null);
});

test("debounced_old_graph_is_cancelled", async () => {
  const saved: string[] = [];
  const queue = new SettingsWriteQueue<string>(async (_value, root) => {
    saved.push(root);
  });
  queue.setGraph("A");
  queue.schedule("A", "old settings", 5);
  queue.setGraph("B");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await queue.idle();

  assert.deepEqual(saved, []);
});
