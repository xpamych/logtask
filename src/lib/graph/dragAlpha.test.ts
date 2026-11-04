import test from "node:test";
import assert from "node:assert/strict";
import { nextDragAlpha } from "./dragAlpha.ts";

test("drag не нагревает уже работающую симуляцию повторно", () => {
  assert.equal(nextDragAlpha(0.1, 0.005), 0.1);
  assert.equal(nextDragAlpha(0.4, 0.005, 0.8), 0.4);
});

test("drag пробуждает остановившуюся симуляцию один раз", () => {
  assert.equal(nextDragAlpha(0, 0.005), 0.7);
  assert.equal(nextDragAlpha(0.004, 0.005, 0.8), 0.8);
});
