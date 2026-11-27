import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageTree,
  pageNameStem,
  readExpandedDirs,
  revealPath,
  writeExpandedDirs,
} from "./pageTree.ts";

test("имя файла отделяется от canonical пути для проверки rename без изменений", () => {
  assert.equal(pageNameStem("Logtask/Dir/blink-codes"), "blink-codes");
  assert.equal(pageNameStem("2026_11_27"), "2026_11_27");
});

test("дерево содержит пустые каталоги, сортирует ветви и сохраняет полные имена страниц", () => {
  const root = buildPageTree(
    {
      pages: ["Заметки/Бета", "Заметки/Dir/Альфа", "Заметки/Dir"],
      directories: ["Dir", "Dir/Empty", "Архив"],
    },
    "Заметки",
  );

  assert.equal(root.name, "Заметки");
  assert.deepEqual(root.children.map((node) => [node.kind, node.name]), [
    ["directory", "Архив"],
    ["directory", "Dir"],
    ["page", "Бета"],
    ["page", "Dir"],
  ]);
  const dir = root.children.find((node) => node.kind === "directory" && node.name === "Dir")!;
  assert.deepEqual(dir.children.map((node) => [node.kind, node.name, node.path]), [
    ["directory", "Empty", "Заметки/Dir/Empty"],
    ["page", "Альфа", "Заметки/Dir/Альфа"],
  ]);
});

test("корень развёрнут по умолчанию даже после прежнего сворачивания", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
  assert.deepEqual([...readExpandedDirs(storage, "/graphs/one", "One")], ["One"]);
  writeExpandedDirs(storage, "/graphs/one", new Set());
  assert.deepEqual([...readExpandedDirs(storage, "/graphs/one", "One")], ["One"]);
});

test("состояние развёрнутых веток независимо для графов и переносит malformed JSON", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
  writeExpandedDirs(storage, "/graphs/one", new Set(["One/Dir"]));
  writeExpandedDirs(storage, "/graphs/two", new Set(["Two/Other"]));
  assert.deepEqual([...readExpandedDirs(storage, "/graphs/one")], ["One/Dir"]);
  assert.deepEqual([...readExpandedDirs(storage, "/graphs/two")], ["Two/Other"]);
  storage.setItem("logtask:expanded-pages:/graphs/bad", "{broken");
  assert.deepEqual([...readExpandedDirs(storage, "/graphs/bad")], []);
});

test("revealPath разворачивает всех предков", () => {
  const expanded = new Set<string>();
  revealPath(expanded, "Заметки/Dir/Deep");
  assert.deepEqual([...expanded].sort(), ["Заметки", "Заметки/Dir", "Заметки/Dir/Deep"]);
});
