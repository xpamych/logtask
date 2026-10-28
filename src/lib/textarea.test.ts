import assert from "node:assert/strict";
import test from "node:test";
import { fitTextarea } from "./textarea.ts";

function mockTextarea() {
  return {
    style: {} as Record<string, string>,
    scrollHeight: 120,
  } as unknown as HTMLTextAreaElement;
}

function withFieldSizing(supported: boolean, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "CSS");
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { supports: () => supported },
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "CSS", previous);
    else delete (globalThis as { CSS?: unknown }).CSS;
  }
}

test("textarea использует нативный field-sizing при поддержке", () => {
  withFieldSizing(true, () => {
    const el = mockTextarea();
    fitTextarea(el);
    assert.equal(el.style.fieldSizing, "content");
    assert.equal(el.style.overflow, "hidden");
  });
});

test("textarea без field-sizing растёт по scrollHeight и пересчитывается повторно", () => {
  withFieldSizing(false, () => {
    const el = mockTextarea();
    fitTextarea(el);
    assert.equal(el.style.height, "120px");
    el.scrollHeight = 240;
    fitTextarea(el);
    assert.equal(el.style.height, "240px");
    assert.equal(el.style.overflow, "hidden");
  });
});
