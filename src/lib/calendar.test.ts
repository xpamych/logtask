import assert from "node:assert/strict";
import test from "node:test";
import { monthGrid, shiftMonth } from "./calendar.ts";

const names = (year: number, month: number, weekStart: 0 | 1) =>
  monthGrid(year, month, weekStart).map((day) => day.date);

test("месяц начинается с воскресенья по настройке", () => {
  const days = names(2026, 11, 0);
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026_11_01");
  assert.equal(days[41], "2026_12_12");
});

test("месяц начинается с понедельника и содержит соседние дни", () => {
  const days = names(2026, 11, 1);
  assert.equal(days[0], "2026_10_26");
  assert.equal(days[41], "2026_12_06");
});

test("високосный февраль и смена года", () => {
  const days = monthGrid(2028, 2, 1);
  assert(days.some((day) => day.date === "2028_02_29" && day.inMonth));
  assert(!days.some((day) => day.date === "2028_02_30"));
  assert.deepEqual(shiftMonth(2026, 1, 1), { year: 2026, month: 2 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test("доступность, текущий день и принадлежность месяцу", () => {
  const days = monthGrid(2026, 11, 1, new Set(["2026_11_07", "2026_10_26"]), "2026_11_07");
  assert.equal(days.find((day) => day.date === "2026_11_07")?.available, true);
  assert.equal(days.find((day) => day.date === "2026_11_07")?.today, true);
  assert.equal(days.find((day) => day.date === "2026_11_08")?.available, false);
  assert.equal(days[0].inMonth, false);
  assert.equal(days.find((day) => day.date === "2026_11_01")?.inMonth, true);
});
