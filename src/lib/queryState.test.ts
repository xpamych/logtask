import assert from "node:assert/strict";
import test from "node:test";
import { upsertQuery } from "./queryState.ts";

const query = (title: string) => ({
  title,
  filter: { open: true, status: [], page: null, pagePrefix: null, excludePage: null, tags: [], quadrant: null },
  sort: [],
  collapsed: false,
});

test("renamed_query_replaces_original", () => {
  const result = upsertQuery([query("Старое"), query("Другая")], query("Новое"), "Старое");

  assert.deepEqual(result.map((item) => item.title), ["Новое", "Другая"]);
});
