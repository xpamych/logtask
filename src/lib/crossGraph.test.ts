import assert from "node:assert/strict";
import test from "node:test";
import type { RecentGraph } from "./api.ts";
import { canonicalRenameTarget, graphBaseName, parseCrossGraphTarget, resolveCrossGraphTarget } from "./crossGraph.ts";

const recents: RecentGraph[] = [
  { path: "/home/user/Other", lastOpened: "2026-01-01" },
  { path: "/home/user/Current", lastOpened: "2026-01-01" },
];

test("разбирает только полную цель с непустым локальным путём", () => {
  assert.deepEqual(parseCrossGraphTarget("Other/Dir/Page", "Current"), {
    graphName: "Other",
    localName: "Dir/Page",
  });
  assert.equal(parseCrossGraphTarget("Page", "Current"), null);
  assert.equal(parseCrossGraphTarget("Other/", "Current"), null);
  assert.equal(graphBaseName("/home/user/Other"), "Other");
});

test("после rename локальный путь становится canonical и не открывает выбор графа", () => {
  const renamed = canonicalRenameTarget("/home/user/Current", "Dir/New");
  assert.equal(renamed, "Current/Dir/New");
  assert.deepEqual(
    resolveCrossGraphTarget(renamed, "/home/user/Current", ["Current/Dir/New"], recents),
    { kind: "local", name: "Current/Dir/New" },
  );
});

test("существующая локальная страница выигрывает у другого графа", () => {
  assert.deepEqual(
    resolveCrossGraphTarget("Other/B", "/home/user/Current", ["Current/Other/B"], recents),
    { kind: "local", name: "Other/B" },
  );
});

test("текущий граф не требует переключения", () => {
  assert.deepEqual(
    resolveCrossGraphTarget("Current/Dir/Page", "/home/user/Current", [], recents),
    { kind: "local", name: "Current/Dir/Page" },
  );
});

test("известный другой граф переключается по полному canonical имени", () => {
  assert.deepEqual(
    resolveCrossGraphTarget("Other/Dir/Page", "/home/user/Current", [], recents),
    { kind: "switch", path: "/home/user/Other", name: "Other/Dir/Page", graphName: "Other" },
  );
});

test("неизвестный и неоднозначный граф различаются", () => {
  assert.deepEqual(
    resolveCrossGraphTarget("Missing/Page", "/home/user/Current", [], recents),
    { kind: "unknown", graphName: "Missing", name: "Missing/Page" },
  );
  const duplicate = [...recents, { path: "/mnt/Other", lastOpened: "2026-01-02" }];
  assert.deepEqual(
    resolveCrossGraphTarget("Other/Page", "/home/user/Current", [], duplicate),
    { kind: "ambiguous", graphName: "Other" },
  );
});
