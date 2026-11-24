import assert from "node:assert/strict";
import test from "node:test";
import { blockCollectionKeyAllowed, hasBlockChildren, toggleCollapsed, visibleBlockUuids } from "./blockTree.ts";
import type { BlockDto } from "./api.ts";

const block = (uuid: string, indent: number): BlockDto => ({
  uuid, indent, status: null, statusLabel: null, priority: null, content: uuid,
  task: false, urgency: null, importance: null, links: [], clockRunning: false,
  clockTotal: null, deadline: null, scheduled: null, extra: [], source: uuid,
});
const blocks = [block("a", 0), block("a1", 1), block("a2", 2), block("b", 0)];

test("fold скрывает всех потомков, но не соседей", () => {
  assert.deepEqual(visibleBlockUuids(blocks, new Set()), ["a", "a1", "a2", "b"]);
  assert.deepEqual(visibleBlockUuids(blocks, new Set(["a"])), ["a", "b"]);
  assert.deepEqual(visibleBlockUuids(blocks, new Set(["a1"])), ["a", "a1", "b"]);
});

test("fold переключается без мутации прежнего набора", () => {
  const initial = new Set<string>();
  const collapsed = toggleCollapsed(initial, "a");
  assert.deepEqual([...collapsed], ["a"]);
  assert.equal(initial.size, 0);
  assert.equal(toggleCollapsed(collapsed, "a").size, 0);
  assert.equal(hasBlockChildren(blocks, "a1"), true);
  assert.equal(hasBlockChildren(blocks, "b"), false);
});

test("клавиши активного текстового редактора не становятся блочными командами", () => {
  assert.equal(blockCollectionKeyAllowed(true), false);
  assert.equal(blockCollectionKeyAllowed(false), true);
});
