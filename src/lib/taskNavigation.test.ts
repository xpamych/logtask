import assert from "node:assert/strict";
import test from "node:test";
import { primaryTaskElement, visibleTaskUuid } from "./taskNavigation.ts";

const element = (uuid: string, visible = true) =>
  ({
    dataset: { taskUuid: uuid },
    offsetParent: visible ? {} : null,
  }) as unknown as HTMLElement;

test("навигация учитывает направление, границы и скрытые карточки", () => {
  const items = [element("a"), element("hidden", false), element("b"), element("c")];
  assert.equal(visibleTaskUuid([], 1, null), null);
  assert.equal(visibleTaskUuid(items, 1, null), "a");
  assert.equal(visibleTaskUuid(items, -1, null), "c");
  assert.equal(visibleTaskUuid(items, 1, "a"), "b");
  assert.equal(visibleTaskUuid(items, 1, "c"), "c");
  assert.equal(visibleTaskUuid(items, -1, "a"), "a");
  assert.equal(visibleTaskUuid(items, -1, "c"), "b");
});

test("из дублей задачи команду выполняет только первая видимая копия", () => {
  const first = element("same");
  const second = element("same");
  assert.equal(primaryTaskElement([first, second], "same"), first);
  assert.notEqual(primaryTaskElement([first, second], "same"), second);
});
