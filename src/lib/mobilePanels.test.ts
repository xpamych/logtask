import assert from "node:assert/strict";
import test from "node:test";

import { mobilePanelAfterNavigation, mobilePanelAfterToggle, panelVisible } from "./mobilePanels.ts";

test("мобильные панели открываются по одной", () => {
  assert.equal(mobilePanelAfterToggle(null, "left"), "left");
  assert.equal(mobilePanelAfterToggle("left", "right"), "right");
  assert.equal(mobilePanelAfterToggle("right", "left"), "left");
});

test("повторное нажатие закрывает мобильную панель", () => {
  assert.equal(mobilePanelAfterToggle("left", "left"), null);
  assert.equal(mobilePanelAfterToggle("right", "right"), null);
});

test("на desktop видимость следует сохранённой свёрнутости", () => {
  assert.equal(panelVisible(false, false, null, "left"), true);
  assert.equal(panelVisible(false, true, "left", "left"), false);
});

test("на мобильном видна только явно открытая панель", () => {
  assert.equal(panelVisible(true, false, null, "left"), false);
  assert.equal(panelVisible(true, false, "left", "left"), true);
  assert.equal(panelVisible(true, false, "right", "left"), false);
  assert.equal(panelVisible(true, true, "left", "left"), true);
});

test("навигация сохраняет правую панель только для действий из неё", () => {
  assert.equal(mobilePanelAfterNavigation("right", true), "right");
  assert.equal(mobilePanelAfterNavigation("right", false), null);
  assert.equal(mobilePanelAfterNavigation("left", true), null);
  assert.equal(mobilePanelAfterNavigation("left", false), null);
});
