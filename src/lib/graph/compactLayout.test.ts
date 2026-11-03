import assert from "node:assert/strict";
import test from "node:test";
import { compactComponentRadius } from "./layout.ts";

test("компактный радиус компоненты меньше прежнего разброса", () => {
  assert.equal(compactComponentRadius(100), 50);
  assert.equal(compactComponentRadius(2), Math.max(12, Math.sqrt(2) * 5));
  assert.equal(compactComponentRadius(1), 12);
  assert.equal(compactComponentRadius(100, 90), 100);
  assert.equal(compactComponentRadius(100, 0), 12);
});
