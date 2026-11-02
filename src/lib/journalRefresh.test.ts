import assert from "node:assert/strict";
import test from "node:test";
import { visibleJournalsAfterRefresh } from "./journalRefresh.ts";

test("обновление сохраняет число загруженных дней и добавляет новый день", () => {
  const current = ["2026_11_02", "2026_11_01", "2026_10_31", "2026_10_30", "2026_10_29", "2026_10_28", "2026_10_27"];
  const available = ["2026_11_03", ...current, "2026_10_26", "2026_10_25"];
  assert.deepEqual(visibleJournalsAfterRefresh(current, available, 5), [
    "2026_11_03",
    "2026_11_02",
    "2026_11_01",
    "2026_10_31",
    "2026_10_30",
    "2026_10_29",
    "2026_10_28",
    "2026_10_27",
  ]);
});

test("первая загрузка ограничена размером порции", () => {
  const available = ["2026_11_03", "2026_11_02", "2026_11_01", "2026_10_31", "2026_10_30", "2026_10_29"];
  assert.deepEqual(visibleJournalsAfterRefresh([], available, 5), available.slice(0, 5));
});
