import test from "node:test";
import assert from "node:assert/strict";
import { LabelAtlasLayout, allowLabel, labelCacheKey, labelOutsideCanvas, labelSpriteCssSize, labelText } from "./labelAtlas.ts";
import type { LabelDescriptor } from "./labelAtlas.ts";

function descriptor(key: string, overrides: Partial<LabelDescriptor> = {}): LabelDescriptor {
  return {
    key,
    text: key,
    x: 10,
    y: 20,
    opacity: 0.75,
    bold: false,
    priority: false,
    color: "#ffffff",
    ...overrides,
  };
}

test("подпись усекается до 42 символов с многоточием", () => {
  assert.equal(labelText("короткая"), "короткая");
  assert.equal(labelText("x".repeat(50)), `${"x".repeat(41)}…`);
});

test("ключ atlas учитывает стиль, тему и pixel ratio", () => {
  const base = labelCacheKey(descriptor("A"), 1);
  assert.notEqual(base, labelCacheKey(descriptor("A", { bold: true }), 1));
  assert.notEqual(base, labelCacheKey(descriptor("A", { color: "#222222" }), 1));
  assert.notEqual(base, labelCacheKey(descriptor("A"), 2));
  assert.equal(base, labelCacheKey(descriptor("A"), 1));
});

test("лимит 200 не скрывает priority и offscreen проверяется с запасом", () => {
  assert.equal(allowLabel(0.5, false, 199), true);
  assert.equal(allowLabel(0.5, false, 200), false);
  assert.equal(allowLabel(0.5, true, 200), true);
  assert.equal(allowLabel(0, true, 200), false);
  assert.equal(labelOutsideCanvas(10, 20, 800, 600), false);
  assert.equal(labelOutsideCanvas(-101, 20, 800, 600), true);
  assert.equal(labelOutsideCanvas(10, 631, 800, 600), true);
});

test("atlas растеризует только новые ключи и сохраняет opacity", () => {
  const layout = new LabelAtlasLayout(64);
  const rendered: string[] = [];
  const measure = (_label: LabelDescriptor) => ({ width: 20, height: 10 });
  const first = layout.sync([descriptor("A"), descriptor("B")], 1, measure, rendered);
  assert.equal(rendered.length, 2);
  const second = layout.sync([descriptor("A"), descriptor("B")], 1, measure, rendered);
  assert.equal(rendered.length, 2);
  assert.deepEqual(first.map((sprite) => sprite.opacity), [0.75, 0.75]);
  assert.deepEqual(first.map((sprite) => [sprite.x, sprite.y]), [[10, 20], [10, 20]]);
  assert.deepEqual(second, first);
});

test("overflow детерминированно пересобирает atlas без потери priority", () => {
  const labels = [
    ...Array.from({ length: 30 }, (_, index) => descriptor(`N${index}`)),
    descriptor("P", { priority: true, bold: true }),
  ];
  const measure = () => ({ width: 20, height: 10 });
  const first = new LabelAtlasLayout(64);
  const second = new LabelAtlasLayout(64);
  const a = first.sync(labels, 1, measure, []);
  const b = second.sync(labels, 1, measure, []);
  assert.deepEqual(a, b);
  assert.equal(a.length, labels.length);
  assert(a.some((sprite) => sprite.key === "P"));
  assert(first.atlasSize >= 128);
});

test("overflow пересобирает UV и растеризацию всех подписей на следующем кадре", () => {
  const layout = new LabelAtlasLayout(64);
  const measure = () => ({ width: 20, height: 10 });
  const initial = Array.from({ length: 3 }, (_, index) => descriptor(`N${index}`));
  layout.sync(initial, 1, measure, []);
  const labels = [
    ...Array.from({ length: 30 }, (_, index) => descriptor(`N${index}`)),
    descriptor("P", { priority: true, bold: true }),
  ];
  const rendered: string[] = [];
  const sprites = layout.sync(labels, 1, measure, rendered);
  assert(layout.atlasSize >= 128);
  for (const sprite of sprites) {
    assert(Math.abs((sprite.u1 - sprite.u0) - 20 / layout.atlasSize) < 1e-9);
    assert(sprite.u0 >= 0 && sprite.u1 <= 1);
  }
  assert.equal(layout.pending.length, labels.length);
  assert(rendered.some((key) => key.startsWith("N0")));
  assert(sprites.some((sprite) => sprite.key === "P"));
});

test("размер sprite остаётся CSS-величиной при разных DPR", () => {
  assert.equal(labelSpriteCssSize(20, 1), 20);
  assert.equal(labelSpriteCssSize(20, 1.5), 13.333333333333334);
  assert.equal(labelSpriteCssSize(20, 2), 10);
});
