import assert from "node:assert/strict";
import test from "node:test";
import { PageLoadGuard } from "./pageLoad.ts";

test("stale_page_response_and_error_are_ignored", () => {
  const guard = new PageLoadGuard();
  const stale = guard.begin();
  const current = guard.begin();

  assert.equal(guard.isCurrent(stale), false);
  assert.equal(guard.isCurrent(current), true);
});
