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

test("подпись сохраняет полное название", () => {
  assert.equal(labelText("короткая"), "короткая");
  assert.equal(labelText("x".repeat(50)), "x".repeat(50));
});

test("ключ atlas учитывает стиль, тему и pixel ratio", () => {
  const base = labelCacheKey(descriptor("A"), 1);
  assert.notEqual(base, labelCacheKey(descriptor("A", { bold: true }), 1));
  assert.notEqual(base, labelCacheKey(descriptor("A", { color: "#222222" }), 1));
  assert.notEqual(base, labelCacheKey(descriptor("A"), 2));
  assert.equal(base, labelCacheKey(descriptor("A"), 1));
});

test("невидимость отсекается, лимита подписей нет, offscreen проверяется с запасом", () => {
  assert.equal(allowLabel(0.5, false, 199), true);
  assert.equal(allowLabel(0.5, false, 200), true);
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
  assert.deepEqual(first.map((sprite) => [sprite.x, sprite.y]), [[0, 20], [0, 20]]);
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


test("размер подписи входит в ключ кэша атласа", () => {
  const descriptor = {
    key: "A", text: "Страница", x: 0, y: 0, opacity: 1,
    bold: false, priority: false, color: "#fff",
  };
  assert.notEqual(
    labelCacheKey({ ...descriptor, fontSize: 16 }, 1),
    labelCacheKey({ ...descriptor, fontSize: 20 }, 1),
  );
});


test("высота строки атласа учитывает крупный шрифт и обводку", async () => {
  const { labelLineHeight } = await import("./labelAtlas.ts");
  const descriptor = {
    key: "A", text: "Хаб", x: 0, y: 0, opacity: 1,
    bold: false, priority: false, color: "#fff", fontSize: 20,
  };
  assert.equal(labelLineHeight(descriptor), 31);
  assert.equal(labelLineHeight({ ...descriptor, fontSize: 10 }), 17.5);
});


test("подпись масштабируется от центра, а не уезжает вправо", () => {
  const layout = new LabelAtlasLayout(128);
  const measure = () => ({ width: 100, height: 20 });
  const normal = layout.sync([descriptor("A", { x: 200, scale: 1 })], 1, measure, [])[0];
  const enlarged = layout.sync([descriptor("A", { x: 200, scale: 2 })], 1, measure, [])[0];
  assert.equal(normal.x, 150);
  assert.equal(normal.x + normal.width / 2, 200);
  assert.equal(enlarged.x, 100);
  assert.equal(enlarged.x + enlarged.width / 2, 200);
});


test("названия не усекаются и переносятся по словам и длинным токенам", async () => {
  const { labelText, wrapLabelLines } = await import("./labelAtlas.ts");
  assert.equal(labelText("x".repeat(50)), "x".repeat(50));
  const measure = (text: string) => text.length * 10;
  assert.deepEqual(wrapLabelLines("абвг дежз", 45, measure), ["абвг", "дежз"]);
  assert.deepEqual(wrapLabelLines("abcdefgh", 30, measure), ["abc", "def", "gh"]);
  assert.deepEqual(wrapLabelLines("", 30, measure), [""]);
});

test("лимит 200 и DPR 2 не меняют доступность и CSS-размер подписи", async () => {
  const { allowLabel, labelRasterToSpriteSize } = await import("./labelAtlas.ts");
  assert.equal(allowLabel(0.5, false, 10000), true);
  assert.equal(allowLabel(0, false, 0), false);
  assert.equal(labelRasterToSpriteSize(40), 20);
});


test("2× raster сохраняет центр после обратного преобразования", async () => {
  const { labelRasterToSpriteGeometry } = await import("./labelAtlas.ts");
  assert.deepEqual(labelRasterToSpriteGeometry(150, 100), { x: 175, width: 50 });
  assert.deepEqual(labelRasterToSpriteGeometry(100, 200), { x: 150, width: 100 });
});

test("atlas не превышает GPU texture limit", async () => {
  const { atlasSizeSupported } = await import("./labelAtlas.ts");
  assert.equal(atlasSizeSupported(8192, 8192), true);
  assert.equal(atlasSizeSupported(16384, 8192), false);
});
