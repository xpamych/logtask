import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "solid-js";
import { refreshGuarded, setEditingBlock } from "./editState.ts";

test("перезагрузка ждёт завершения редактирования карточки", async () => {
  createRoot(async (dispose) => {
    let reloads = 0;
    const guardedReload = refreshGuarded(() => reloads++);

    setEditingBlock("task-1");
    guardedReload();
    assert.equal(reloads, 0);

    setEditingBlock(null);
    await Promise.resolve();
    assert.equal(reloads, 1);
    dispose();
  });
});
