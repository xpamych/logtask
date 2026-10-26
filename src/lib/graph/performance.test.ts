import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import { QualityController, qualityForSettings } from "./performance.ts";

test("контроллер качества снижает уровень с гистерезисом и восстанавливает", () => {
  const controller = new QualityController();
  for (let index = 0; index < 60; index += 1) controller.sample(45);
  assert(controller.level >= 1);
  const degraded = controller.level;
  for (let index = 0; index < 150; index += 1) controller.sample(10);
  assert(controller.level < degraded);
});

test("упрощения не перезаписывают ручные настройки", () => {
  const settings = { ...DEFAULT_GRAPH_VIEW_SETTINGS, arrows: true, labelThreshold: 0.2, alphaDecay: 0.03 };
  assert.equal(qualityForSettings(settings, 1).arrows, true);
  assert(qualityForSettings(settings, 1).alphaDecay > settings.alphaDecay);
  assert(qualityForSettings(settings, 2).labelThreshold >= 1);
  assert.equal(qualityForSettings(settings, 3).arrows, false);
  assert.equal(qualityForSettings(settings, 4).clusterThreshold, 20);
  assert.equal(settings.labelThreshold, 0.2);
});
