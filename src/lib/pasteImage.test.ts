import assert from "node:assert/strict";
import test from "node:test";
import { insertAtCursor, pasteImage } from "./pasteImage.ts";

const textarea = (value: string, start: number, end = start) =>
  ({ value, selectionStart: start, selectionEnd: end }) as HTMLTextAreaElement;

const event = (items: { type: string; file?: File }[]) =>
  ({
    clipboardData: {
      items: items.map((item) => ({
        type: item.type,
        getAsFile: () => item.file ?? null,
      })),
    },
    preventDefault() {},
  }) as unknown as ClipboardEvent;

test("разметка вставляется на место курсора и вместо выделения", () => {
  assert.deepEqual(insertAtCursor("ab", 0, 0, "X"), { text: "Xab", caret: 1 });
  assert.deepEqual(insertAtCursor("ab", 1, 1, "X"), { text: "aXb", caret: 2 });
  assert.deepEqual(insertAtCursor("ab", 2, 2, "X"), { text: "abX", caret: 3 });
  assert.deepEqual(insertAtCursor("abcd", 1, 3, "X"), { text: "aXd", caret: 2 });
});

test("текстовый paste не перехватывается", async () => {
  const result = await pasteImage(event([{ type: "text/plain" }]), textarea("abc", 1), async () => {
    throw new Error("не должен вызываться");
  });
  assert.deepEqual(result, { handled: false });
});

test("изображение сохраняется и вставляется в draft", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });
  const result = await pasteImage(event([{ type: "image/png", file }]), textarea("abcd", 1, 3), async (data, mime) => {
    assert.deepEqual(data, [1, 2, 3]);
    assert.equal(mime, "image/png");
    return "assets/x.png";
  });
  assert.deepEqual(result, { handled: true, text: "a![[../assets/x.png]]d", caret: 21 });
});

test("ошибка сохранения не меняет draft", async () => {
  const file = new File([new Uint8Array([1])], "screen.png", { type: "image/png" });
  const result = await pasteImage(event([{ type: "image/png", file }]), textarea("abc", 1), async () => {
    throw new Error("диск недоступен");
  });
  assert.deepEqual(result, { handled: true, error: "диск недоступен" });
});

test("повторная вставка во время записи игнорируется", async () => {
  const file = new File([new Uint8Array([1])], "screen.png", { type: "image/png" });
  const area = textarea("abc", 1);
  let finish!: (path: string) => void;
  const pending = pasteImage(event([{ type: "image/png", file }]), area, () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  const second = await pasteImage(event([{ type: "image/png", file }]), area, async () => "assets/second.png");
  assert.deepEqual(second, { handled: true });
  finish("assets/first.png");
  const first = await pending;
  assert.equal(first.text, "a![[../assets/first.png]]bc");
});
