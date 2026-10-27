import test from "node:test";
import assert from "node:assert/strict";

const interactions = await import("./pointerInteraction.ts").catch(() => null);

test("медленный drag определяется по смещению от pointer-down", () => {
  assert.ok(interactions);
  assert.equal(interactions.hasPointerDragged(100, 100, 101, 100), false);
  assert.equal(interactions.hasPointerDragged(100, 100, 102, 100), false);
  assert.equal(interactions.hasPointerDragged(100, 100, 104, 100), true);
});

test("pointercancel не создаёт клик независимо от перемещения", () => {
  assert.ok(interactions);
  assert.equal(interactions.shouldClickPointer(false, false), true);
  assert.equal(interactions.shouldClickPointer(true, false), false);
  assert.equal(interactions.shouldClickPointer(false, true), false);
  assert.equal(interactions.shouldClickPointer(true, true), false);
});
