import type { GraphLayoutEntry } from "~/lib/api";
import { visualGraphLayoutSave } from "~/lib/api";

export function createLayoutSaver(scope: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: GraphLayoutEntry[] = [];
  const flush = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (latest.length === 0) return;
    const entries = latest;
    latest = [];
    await visualGraphLayoutSave(scope, entries).catch((error) => console.error("сохранение layout:", error));
  };
  return {
    schedule(entries: GraphLayoutEntry[]) {
      latest = entries;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), 500);
    },
    flush,
    dispose() {
      void flush();
    },
  };
}
