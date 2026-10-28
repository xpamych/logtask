import test from "node:test";
import assert from "node:assert/strict";
import { loadGraphBootstrap } from "./startup.ts";

test("страницы и настройки запрашиваются параллельно после загрузки графа", async () => {
  const calls: string[] = [];
  let resolveGraph!: (summary: { root: string }) => void;
  const pending = loadGraphBootstrap(
    () => {
      calls.push("graph");
      return new Promise<{ root: string }>((resolve) => { resolveGraph = resolve; });
    },
    () => {
      calls.push("pages");
      return Promise.resolve(["A", "B"]);
    },
    () => {
      calls.push("settings");
      return Promise.resolve({ homeView: "graph" });
    },
  );

  await Promise.resolve();
  assert.deepEqual(calls, ["graph"]);
  resolveGraph({ root: "/граф" });
  await Promise.resolve();
  assert(calls.includes("pages"));
  assert(calls.includes("settings"));

  assert.deepEqual(await pending, {
    summary: { root: "/граф" },
    pages: ["A", "B"],
    settings: { homeView: "graph" },
  });
});

test("ошибка загрузки графа пробрасывается без запросов страниц и настроек", async () => {
  let secondaryCalled = false;
  const secondary = () => {
    secondaryCalled = true;
    return Promise.resolve(null);
  };

  await assert.rejects(
    loadGraphBootstrap(() => Promise.reject(new Error("диск недоступен")), secondary, secondary),
    /диск недоступен/,
  );
  assert.equal(secondaryCalled, false);
});
