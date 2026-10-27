import test from "node:test";
import assert from "node:assert/strict";
import { homeViewFromSetting } from "./homeView.ts";

test("домашний вид соответствует сохранённой настройке", () => {
  const cases = [
    ["journal", { kind: "journal" }],
    ["tasks", { kind: "tasks" }],
    ["pages", { kind: "pages" }],
    ["graph", { kind: "graph" }],
  ] as const;

  for (const [setting, expected] of cases) {
    assert.deepEqual(homeViewFromSetting(setting), expected);
  }
});

test("неизвестная или пустая настройка открывает журнал", () => {
  assert.deepEqual(homeViewFromSetting("unknown"), { kind: "journal" });
  assert.deepEqual(homeViewFromSetting(""), { kind: "journal" });
});
