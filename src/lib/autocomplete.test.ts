import assert from "node:assert/strict";
import test from "node:test";
import { AutocompleteController, type AutocompleteItem } from "./autocomplete.ts";

const ID = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a812";
const block = (uuid: string, text: string): AutocompleteItem => ({ id: uuid, text, page: "Журнал" });

function fixture(overrides: Record<string, unknown> = {}) {
  const accepted: { text: string; caret: number }[] = [];
  const errors: string[] = [];
  const controller = new AutocompleteController({
    searchPages: async () => ["Alpha", "Beta"],
    searchBlocks: async () => [block("one", "Первый"), block("two", "Второй")],
    createRef: async () => ({ ref: `((${ID}))`, uuid: "fresh" }),
    onAccept: (result) => accepted.push(result),
    onError: (error) => errors.push(error),
    debounceMs: 0,
    ...overrides,
  });
  return { controller, accepted, errors };
}

test("page autocomplete вставляет wiki-ссылку и управляет клавиатурой", async () => {
  const { controller, accepted } = fixture();
  await controller.onInput("[[Al", 4);
  assert.equal(controller.open, true);
  assert.deepEqual(controller.items.map((item) => item.text), ["Alpha", "Beta"]);
  assert.equal(controller.onKeyDown({ key: "ArrowDown", preventDefault() {} }), true);
  await controller.onKeyDown({ key: "Enter", preventDefault() {} });
  assert.deepEqual(accepted, [{ text: "[[Beta]]", caret: 8 }]);
  assert.equal(controller.open, false);
  assert.equal(controller.onKeyDown({ key: "Enter", preventDefault() {} }), false);
});

test("block autocomplete создаёт постоянный ref до вставки", async () => {
  const events: string[] = [];
  const { controller, accepted } = fixture({
    createRef: async (uuid: string) => {
      events.push(`create:${uuid}`);
      return { ref: `((${ID}))`, uuid: "fresh" };
    },
    onAccept: (result: { text: string; caret: number }) => {
      accepted.push(result);
      events.push("accept");
    },
  });
  await controller.onInput("((перв", 6);
  await controller.onKeyDown({ key: "Tab", preventDefault() {} });
  assert.deepEqual(events, ["create:one", "accept"]);
  assert.equal(accepted[0].text, `((${ID}))`);
});

test("пустой block query не вызывает IPC", async () => {
  let calls = 0;
  const { controller } = fixture({
    searchBlocks: async () => { calls++; return []; },
  });
  await controller.onInput("((", 2);
  assert.equal(calls, 0);
  assert.equal(controller.open, false);
});

test("устаревший ответ поиска не заменяет новый", async () => {
  let resolveOld!: (items: AutocompleteItem[]) => void;
  const { controller } = fixture({
    searchBlocks: (query: string) => query === "old"
      ? new Promise<AutocompleteItem[]>((resolve) => { resolveOld = resolve; })
      : Promise.resolve([block("new", "Новый")]),
  });
  const old = controller.onInput("((old", 5);
  const current = controller.onInput("((new", 5);
  resolveOld([block("old", "Старый")]);
  await Promise.all([old, current]);
  assert.deepEqual(controller.items.map((item) => item.id), ["new"]);
});

test("ошибка создания ref сохраняет draft и сообщает причину", async () => {
  const { controller, accepted, errors } = fixture({
    createRef: async () => { throw new Error("диск недоступен"); },
  });
  await controller.onInput("((перв", 6);
  await controller.accept(controller.items[0]);
  assert.equal(accepted.length, 0);
  assert.deepEqual(errors, ["диск недоступен"]);
});

test("Escape закрывает список, стрелки цикличны", async () => {
  const { controller } = fixture();
  await controller.onInput("[[A", 3);
  assert.equal(controller.onKeyDown({ key: "ArrowUp", preventDefault() {} }), true);
  assert.equal(controller.activeIndex, 1);
  assert.equal(controller.onKeyDown({ key: "ArrowDown", preventDefault() {} }), true);
  assert.equal(controller.activeIndex, 0);
  assert.equal(controller.onKeyDown({ key: "Escape", preventDefault() {} }), true);
  assert.equal(controller.open, false);
});
