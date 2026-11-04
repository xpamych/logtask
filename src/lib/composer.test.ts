import assert from "node:assert/strict";
import test from "node:test";
import { composerMarker } from "./composer.ts";

test("new_task_command_uses_todo_but_plain_composer_does_not", () => {
  assert.equal(composerMarker("command"), "TODO");
  assert.equal(composerMarker("plain"), null);
});
