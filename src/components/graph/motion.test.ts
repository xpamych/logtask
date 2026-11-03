import assert from "node:assert/strict";
import test from "node:test";
import { interpolateValue, smoothStepAmount, transitionAlpha, zoomCameraTarget } from "./motion.ts";

test("интерполяция зависит от времени, а не от числа кадров", () => {
  const amount = smoothStepAmount(100, 0.2);
  assert(Math.abs(amount - 0.3934693403) < 1e-9);
  assert.equal(interpolateValue(0, 100, 0, 0.2), 0);
  assert.equal(interpolateValue(0, 100, 1000, 0.2), 100);
  assert.equal(smoothStepAmount(-1, 0.2), 0);
});

test("новая цель zoom сохраняет мировую точку под курсором", () => {
  const camera = { x: 20, y: -10, zoom: 2 };
  const target = zoomCameraTarget(camera, 1.5, 100, 50, 800, 600);
  const beforeX = (100 - 400) / 2 + 20;
  const beforeY = (50 - 300) / 2 - 10;
  const afterX = (100 - 400) / target.zoom + target.x;
  const afterY = (50 - 300) / target.zoom + target.y;
  assert(Math.abs(beforeX - afterX) < 1e-9);
  assert(Math.abs(beforeY - afterY) < 1e-9);
  assert.equal(zoomCameraTarget(camera, 1000, 400, 300, 800, 600).zoom, 5);
  assert.equal(zoomCameraTarget(camera, 0.0001, 400, 300, 800, 600).zoom, 0.05);
});

test("fade начинается с текущей прозрачности и завершается на цели", () => {
  const fading = transitionAlpha(0.25, 1, 60, 0.12, false);
  assert(fading.value > 0.25 && fading.value < 1);
  assert(fading.moving);
  assert.deepEqual(transitionAlpha(fading.value, 1, 1000, 0.12, false), { value: 1, moving: false });
  assert.deepEqual(transitionAlpha(0.25, 1, 60, 0.12, true), { value: 1, moving: false });
});
