import assert from "node:assert/strict";
import test from "node:test";
import { findJournalDay } from "./journalOpen.ts";

test("день из следующей порции загружается без дублей", async () => {
  const batches: Record<string, string[]> = {
    "2026_11_07": ["2026_11_06", "2026_11_05", "2026_11_06"],
  };
  assert.deepEqual(await findJournalDay("2026_11_05", "2026_11_07", async (before) => batches[before]), [
    "2026_11_06",
    "2026_11_05",
  ]);
});

test("старый день требует нескольких порций", async () => {
  const batches: Record<string, string[]> = {
    "2026_11_07": ["2026_11_06", "2026_11_05"],
    "2026_11_05": ["2026_11_04", "2026_11_03"],
    "2026_11_03": ["2026_11_02", "2026_11_01"],
  };
  assert.deepEqual(await findJournalDay("2026_11_01", "2026_11_07", async (before) => batches[before]), [
    "2026_11_06",
    "2026_11_05",
    "2026_11_04",
    "2026_11_03",
    "2026_11_02",
    "2026_11_01",
  ]);
});

test("несуществующий день останавливается на конце списка", async () => {
  await assert.rejects(
    findJournalDay("2020_01_01", "2026_11_07", async () => []),
    /не найден/,
  );
});
