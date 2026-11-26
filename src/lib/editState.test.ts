import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "solid-js";
import { refreshGuarded, setEditingBlock, setPendingEdit, trackOpenBlockMenu } from "./editState.ts";

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

test("pendingEdit разрешает перезагрузку для монтирования нового блока", async () => {
  createRoot(async (dispose) => {
    let reloads = 0;
    const guardedReload = refreshGuarded(() => reloads++);
    setPendingEdit({ uuid: "new-block", at: 0 });
    setEditingBlock("new-block");
    await new Promise((resolve) => setTimeout(resolve, 0));
    guardedReload();
    assert.equal(reloads, 1);
    setPendingEdit(null);
    dispose();
  });
});
