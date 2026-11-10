import assert from "node:assert/strict";
import test from "node:test";
import { pageActionAvailable } from "./commands.ts";

const journal = { current: null, settings: false, graph: false, tasks: false, pages: false };

test("экспорт и печать доступны на странице и в журнале", () => {
  assert.equal(pageActionAvailable(journal), true);
  assert.equal(pageActionAvailable({ ...journal, current: "Страница" }), true);
});

test("экспорт и печать недоступны в остальных разделах даже после посещения журнала", () => {
  for (const view of [
    { ...journal, settings: true },
    { ...journal, graph: true },
    { ...journal, tasks: true },
    { ...journal, pages: true },
  ]) {
    assert.equal(pageActionAvailable(view), false);
  }
});
