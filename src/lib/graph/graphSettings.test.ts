import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "./defaults.ts";
import {
  migrateGraphSettings,
  obsidianCenterFromSlider,
  obsidianCenterToSlider,
  obsidianRepelFromSlider,
  obsidianRepelToSlider,
} from "./graphSettings.ts";

const closeTo = (actual: number, expected: number) => {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
};

test("центрирование использует нелинейную шкалу Obsidian", () => {
  closeTo(obsidianCenterToSlider(0.1), 0.518713248970312);
  closeTo(obsidianCenterFromSlider(obsidianCenterToSlider(0.1)), 0.1);
  closeTo(obsidianCenterFromSlider(0), 0);
  closeTo(obsidianCenterFromSlider(1), 1);
});

test("отталкивание использует кубическую шкалу Obsidian", () => {
  assert.equal(obsidianRepelFromSlider(10), 1000);
  assert.equal(obsidianRepelFromSlider(0), 0);
  assert.equal(obsidianRepelToSlider(1000), 10);
  assert.equal(obsidianRepelFromSlider(25), 8000);
  assert.equal(obsidianRepelToSlider(-10), 0);
});

test("миграция заменяет только прежние значения по умолчанию", () => {
  const migrated = migrateGraphSettings({
    ...DEFAULT_GRAPH_VIEW_SETTINGS,
    centerForce: 0.12,
    repelForce: 45,
    linkForce: 0.75,
    linkDistance: 35,
  });
  assert.equal(migrated.centerForce, 0.1);
  assert.equal(migrated.repelForce, 1000);
  assert.equal(migrated.linkForce, 1);
  assert.equal(migrated.linkDistance, 250);

  const custom = migrateGraphSettings({
    ...DEFAULT_GRAPH_VIEW_SETTINGS,
    centerForce: 0.3,
    repelForce: 120,
    linkForce: 0.5,
    linkDistance: 80,
  });
  assert.equal(custom.centerForce, 0.3);
  assert.equal(custom.repelForce, 120);
  assert.equal(custom.linkForce, 0.5);
  assert.equal(custom.linkDistance, 80);
});
