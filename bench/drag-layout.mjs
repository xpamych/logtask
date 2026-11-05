import { performance } from "node:perf_hooks";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "../src/lib/graph/defaults.ts";
import { createLatestFrameScheduler } from "../src/components/graph/dragScheduling.ts";

function numberArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? Number(value.slice(prefix.length)) : fallback;
}

const paused = process.argv.includes("--paused");
const scheduled = !process.argv.includes("--unscheduled");
const count = numberArg("nodes", 700);
const dragCount = numberArg("drag", 120);
const ids = Array.from({ length: count }, (_, index) => `P${index}`);
const edges = [];
for (let index = 0; index < count; index += 1) {
  edges.push({ source: `P${index}`, target: `P${(index + 1) % count}` });
  edges.push({ source: `P${index}`, target: `P${(index + 2) % count}` });
}
const xy = new Float32Array(count * 2);
for (let index = 0; index < count; index += 1) {
  const angle = index / count * Math.PI * 2;
  xy[index * 2] = Math.cos(angle) * 300;
  xy[index * 2 + 1] = Math.sin(angle) * 300;
}
const messages = [];
globalThis.self = { postMessage: (message) => messages.push(message) };
await import(`../src/lib/graph/layout.worker.ts?benchmark-${paused}-${scheduled}`);
const send = (type, extra = {}) => globalThis.self.onmessage({ data: { type, generation: 1, ...extra } });
send("init", {
  ids,
  edges,
  positions: { xy, pinned: new Uint8Array(count) },
  settings: DEFAULT_GRAPH_VIEW_SETTINGS,
});
await new Promise((resolve) => setTimeout(resolve, 50));
messages.length = 0;
if (paused) send("pause");
const dragScheduler = scheduled ? createLatestFrameScheduler({
  request: (callback) => setTimeout(callback, 16),
  cancel: (id) => clearTimeout(id),
  emit: (x, y) => send("drag", { id: "P0", x, y, pinned: true }),
}) : null;
const cpuStart = process.cpuUsage();
const wallStart = performance.now();
for (let index = 0; index < dragCount; index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 8));
  const x = 100 + index * 2;
  const y = 100 + index;
  if (dragScheduler) dragScheduler.schedule(x, y);
  else send("drag", { id: "P0", x, y, pinned: true });
}
dragScheduler?.flush();
dragScheduler?.dispose();
await new Promise((resolve) => setTimeout(resolve, 100));
const wall = performance.now() - wallStart;
const cpu = process.cpuUsage(cpuStart);
const frames = messages.filter((message) => message.type === "positions").length;
console.log(JSON.stringify({ nodes: count, dragCount, paused, scheduled, wallMs: Math.round(wall), cpuMs: Math.round((cpu.user + cpu.system) / 1000), frames }));
send("stop");
