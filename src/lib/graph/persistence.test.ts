import test from "node:test";
import assert from "node:assert/strict";
import { cameraKey, loadCamera, markLayoutVersion, needsLayoutMigration, saveCamera } from "./persistence.ts";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

test("камера сохраняется по root и scope, повреждённый JSON игнорируется", () => {
  const storage = new MemoryStorage();
  saveCamera("/граф", "global", { x: 10, y: -5, zoom: 1.4 }, storage);
  assert.deepEqual(loadCamera("/граф", "global", storage), { x: 10, y: -5, zoom: 1.4 });
  assert.equal(loadCamera("/другой", "global", storage), null);
  storage.setItem(cameraKey("/граф", "global"), "not json");
  assert.equal(loadCamera("/граф", "global", storage), null);
  storage.setItem(cameraKey("/граф", "global"), JSON.stringify({ x: "NaN", y: 2, zoom: 1 }));
  assert.equal(loadCamera("/граф", "global", storage), null);
});

test("пустое хранилище требует миграции, отметка текущей версии отключает её", () => {
  const storage = new MemoryStorage();
  assert.equal(needsLayoutMigration("/граф", "global", storage), true);
  markLayoutVersion("/граф", "global", storage);
  assert.equal(needsLayoutMigration("/граф", "global", storage), false);
});

test("версии раскладки независимы для root и scope", () => {
  const storage = new MemoryStorage();
  markLayoutVersion("/граф", "global", storage);
  assert.equal(needsLayoutMigration("/другой", "global", storage), true);
  assert.equal(needsLayoutMigration("/граф", "local:page:Главная", storage), true);
  markLayoutVersion("/другой", "global", storage);
  markLayoutVersion("/граф", "local:page:Главная", storage);
  assert.equal(needsLayoutMigration("/граф", "global", storage), false);
  assert.equal(needsLayoutMigration("/другой", "global", storage), false);
  assert.equal(needsLayoutMigration("/граф", "local:page:Главная", storage), false);
});

test("повреждённая или устаревшая версия безопасно требует миграции", () => {
  const storage = new MemoryStorage();
  storage.setItem("logtask:graph-layout-version:/граф:global", "not json");
  assert.equal(needsLayoutMigration("/граф", "global", storage), true);
  storage.setItem("logtask:graph-layout-version:/граф:global", "0");
  assert.equal(needsLayoutMigration("/граф", "global", storage), true);
});
