import assert from "node:assert/strict";
import test from "node:test";
import type { PageDto } from "./api.ts";
import { savePagesWith } from "./exportActions.ts";

const pages: PageDto[] = [{ name: "Черновик", kind: "page", blocks: [], preamble: [] }];

test("экспорт передаёт подготовленный HTML и имя с расширением в диалог", async () => {
  let received: { name: string; html: string } | null = null;
  const result = await savePagesWith(
    pages,
    async (input) => {
      assert.equal(input, pages);
      return "<!doctype html>";
    },
    async (name, html) => {
      received = { name, html };
      return "/tmp/Черновик.html";
    },
  );

  assert.deepEqual(received, { name: "Черновик.html", html: "<!doctype html>" });
  assert.equal(result, "/tmp/Черновик.html");
});

test("отмена диалога возвращает null", async () => {
  const result = await savePagesWith(pages, async () => "html", async () => null);
  assert.equal(result, null);
});

test("ошибка подготовки или записи пробрасывается вызывающему интерфейсу", async () => {
  await assert.rejects(
    savePagesWith(pages, async () => { throw new Error("нет картинки"); }, async () => null),
    /нет картинки/,
  );
  await assert.rejects(
    savePagesWith(pages, async () => "html", async () => { throw new Error("диск занят"); }),
    /диск занят/,
  );
});
