import test from "node:test";
import assert from "node:assert/strict";
import { cameraKey, loadCamera, saveCamera } from "./persistence.ts";

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
