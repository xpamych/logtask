import assert from "node:assert/strict";
import test from "node:test";
import type { BacklinkDto } from "./api.ts";
import { splitBacklinks } from "./backlinks.ts";

const item = (uuid: string, task: boolean, status: string | null = null): BacklinkDto => ({
  uuid,
  page: "Источник",
  text: uuid,
  task,
  status,
});

test("связанные задачи отделяются от ссылок без дублей и смены порядка", () => {
  const input = [
    item("plain-1", false),
    item("todo", true, "TODO"),
    item("done", true, "DONE"),
    item("plain-2", false),
  ];

  const result = splitBacklinks(input);

  assert.deepEqual(result.tasks.map((x) => x.uuid), ["todo", "done"]);
  assert.deepEqual(result.links.map((x) => x.uuid), ["plain-1", "plain-2"]);
  assert.equal(new Set([...result.tasks, ...result.links]).size, 4);
  assert.deepEqual(input.map((x) => x.uuid), ["plain-1", "todo", "done", "plain-2"]);
});
