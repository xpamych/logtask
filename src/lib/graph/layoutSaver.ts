import type { GraphLayoutEntry } from "~/lib/api";

type SaveLayout = (root: string, scope: string, entries: GraphLayoutEntry[]) => Promise<void>;

export function createLayoutSaver(root: string, scope: string, save: SaveLayout) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: GraphLayoutEntry[] = [];
  let active: Promise<void> | null = null;

  const drain = () => {
    if (active) return active;
    active = (async () => {
      while (latest.length > 0) {
        const entries = latest;
        latest = [];
        await save(root, scope, entries).catch((error) => console.error("сохранение layout:", error));
      }
      active = null;
    })();
    return active;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    return drain();
  };

  return {
    schedule(entries: GraphLayoutEntry[]) {
      latest = entries;
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    },
    flush,
    dispose() {
      void flush();
    },
  };
}
