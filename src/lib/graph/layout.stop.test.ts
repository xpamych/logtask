import test from "node:test";
import assert from "node:assert/strict";
import { startLayoutWorker } from "./layout.ts";

test("stop завершает Worker только после обработки очереди сообщений", async () => {
  const previousWorker = globalThis.Worker;
  const posted: { type: string }[] = [];
  let terminated = false;
  globalThis.Worker = class {
    onmessage = null;
    constructor() {}
    postMessage(message: { type: string }) { posted.push(message); }
    addEventListener() {}
    terminate() { terminated = true; }
  } as unknown as typeof Worker;
  try {
    const worker = startLayoutWorker({ onPositions: () => undefined, onSettled: () => undefined });
    worker.stop();
    assert.equal(terminated, false);
    assert.equal(posted.at(-1)?.type, "stop");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(terminated, true);
  } finally {
    globalThis.Worker = previousWorker;
  }
});
