import assert from "node:assert/strict";
import test from "node:test";
import type { TaskDto } from "./api.ts";
import { applyTaskMenuChange } from "./taskMenuState.ts";

const task: TaskDto = {
  uuid: "task-1",
  page: "2026_11_02",
  content: "Задача",
  status: "TODO",
  statusLabel: "К выполнению",
  priority: null,
  urgency: null,
  importance: null,
  deadline: null,
  scheduled: null,
  tags: [],
  done: false,
  context: false,
  props: [],
  extra: [],
  source: "TODO Задача",
  children: [],
};

test("изменения меню сразу обновляют отображаемую задачу", () => {
  const doing = applyTaskMenuChange(task, { kind: "status", value: "DOING" });
  assert.equal(doing.status, "DOING");
  assert.equal(doing.done, false);

  const important = applyTaskMenuChange(doing, { kind: "importance", value: "high" });
  assert.equal(important.importance, "high");

  const prioritized = applyTaskMenuChange(important, { kind: "priority", value: "A" });
  assert.equal(prioritized.priority, "[#A]");

  const done = applyTaskMenuChange(prioritized, { kind: "status", value: "DONE" });
  assert.equal(done.done, true);
});
