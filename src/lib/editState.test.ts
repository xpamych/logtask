import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "solid-js";
import { refreshGuarded, setEditingBlock, trackOpenBlockMenu } from "./editState.ts";

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

test("перезагрузка ждёт закрытия контекстного меню блока", async () => {
  createRoot(async (dispose) => {
    let reloads = 0;
    const guardedReload = refreshGuarded(() => reloads++);
    const closeMenu = trackOpenBlockMenu();

    guardedReload();
    assert.equal(reloads, 0);

    closeMenu();
    await Promise.resolve();
    assert.equal(reloads, 1);
    dispose();
  });
});
