import assert from "node:assert/strict";
import test from "node:test";
import { activeModalContext, pushModalContext } from "./modalState.ts";

test("верхний модальный контекст блокирует нижележащие действия", () => {
  const closeMenu = pushModalContext("taskMenu");
  const closePalette = pushModalContext("palette");
  assert.equal(activeModalContext(), "palette");
  closePalette();
  assert.equal(activeModalContext(), "taskMenu");
  closeMenu();
  assert.equal(activeModalContext(), null);
});
