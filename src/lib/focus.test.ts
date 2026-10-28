import assert from "node:assert/strict";
import test from "node:test";
import { focusMatchesPage } from "./focus.ts";

test("фокус ждёт загрузки страницы-источника после перехода", () => {
  assert.equal(focusMatchesPage("Предыдущая", "Источник"), false);
  assert.equal(focusMatchesPage(null, "Источник"), false);
  assert.equal(focusMatchesPage("Источник", "Источник"), true);
});
