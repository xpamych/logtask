import assert from "node:assert/strict";
import test from "node:test";
import { insertAtCursor, pasteImage, waitForImagePaste } from "./pasteImage.ts";

const textarea = (value: string, start: number, end = start) =>
  ({ value, selectionStart: start, selectionEnd: end }) as HTMLTextAreaElement;

const event = (items: { type: string; file?: File }[], files: File[] = []) =>
  ({
    clipboardData: {
      items: items.map((item) => ({
        type: item.type,
        getAsFile: () => item.file ?? null,
      })),
      files,
      getData: () => "plain",
    },
    defaultPrevented: false,
    preventDefault(this: { defaultPrevented: boolean }) {
      this.defaultPrevented = true;
    },
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
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const pending = pasteImage(event([{ type: "image/png", file }]), area, () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  });
  await start;
  const second = await pasteImage(event([{ type: "image/png", file }]), area, async () => "assets/second.png");
  assert.deepEqual(second, { handled: true });
  finish("assets/first.png");
  const first = await pending;
  assert.equal(first.text, "a![[../assets/first.png]]bc");
});

test("сохранение ждёт завершения вставки изображения", async () => {
  const file = new File([new Uint8Array([1])], "screen.png", { type: "image/png" });
  const area = textarea("abc", 1);
  let finish!: (path: string) => void;
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const inserted = pasteImage(event([{ type: "image/png", file }]), area, () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  });
  await start;
  let completed = false;
  const waiting = waitForImagePaste(area).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish("assets/x.png");
  await waiting;
  await inserted;
  assert.equal(completed, true);
});

test("неподдерживаемый формат не перехватывается", async () => {
  const file = new File([new Uint8Array([1])], "image.bmp", { type: "image/bmp" });
  const result = await pasteImage(event([{ type: "image/bmp", file }]), textarea("abc", 1), async () => {
    throw new Error("не должен вызываться");
  });
  assert.deepEqual(result, { handled: false });
});

test("изображение читается из files при пустом items", async () => {
  const file = new File([new Uint8Array([1, 2])], "screen.png", { type: "image/png" });
  const result = await pasteImage(event([], [file]), textarea("ab", 1), async () => "assets/x.png");
  assert.deepEqual(result, { handled: true, text: "a![[../assets/x.png]]b", caret: 21 });
});

test("поддерживается application/x-qt-image", async () => {
  const file = new File([new Uint8Array([1])], "screen", { type: "application/x-qt-image" });
  const result = await pasteImage(event([{ type: "application/x-qt-image", file }]), textarea("ab", 1), async () => "assets/x.png");
  assert.equal(result.handled, true);
});

test("пустой DOM clipboard использует нативный fallback", async () => {
  const result = await pasteImage(event([]), textarea("ab", 1), async () => {
    throw new Error("DOM save не нужен");
  }, async () => "assets/native.png");
  assert.deepEqual(result, { handled: true, text: "a![[../assets/native.png]]b", caret: 26 });
});

test("preventDefault вызывается до завершения native IPC", async () => {
  const e = event([]);
  let finish!: (path: string | null) => void;
  const pending = pasteImage(e, textarea("ab", 1), async () => "unused", () => new Promise((resolve) => { finish = resolve; }));
  assert.equal(e.defaultPrevented, true);
  finish("assets/native.png");
  await pending;
});

test("пустой native fallback вставляет обычный текст", async () => {
  const result = await pasteImage(event([]), textarea("ab", 1), async () => "unused", async () => null);
  assert.deepEqual(result, { handled: true, text: "aplainb", caret: 6 });
});

test("ошибка native fallback не меняет draft", async () => {
  const result = await pasteImage(event([]), textarea("ab", 1), async () => "unused", async () => {
    throw new Error("нет доступа");
  });
  assert.deepEqual(result, { handled: true, error: "нет доступа" });
});
