import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import * as graphPerformance from "./performance.ts";

const { QualityController, qualityForSettings } = graphPerformance;

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
  assert.equal(qualityForSettings(settings, 1).qualityTickMs, 50);
  assert.equal(qualityForSettings(settings, 3).qualityTickMs, 100);
  assert(qualityForSettings(settings, 2).labelThreshold >= 1);
  assert.equal(qualityForSettings(settings, 3).arrows, false);
  assert.equal(qualityForSettings(settings, 4).clusterThreshold, 20);
  assert.equal(settings.labelThreshold, 0.2);
});

test("настройки сцены адаптируют только порог кластеризации", () => {
  const settings = { ...DEFAULT_GRAPH_VIEW_SETTINGS, clusterThreshold: 7 };
  const original = { ...settings };
  for (let level = 0; level <= 3; level += 1) {
    assert.deepEqual(graphPerformance.sceneSettingsForQuality(settings, level), settings);
  }
  assert.deepEqual(graphPerformance.sceneSettingsForQuality(settings, 4), {
    ...settings,
    clusterThreshold: 20,
  });
  assert.deepEqual(settings, original);
});
