import type { GraphLayoutEntry } from "~/lib/api";

type SaveLayout = (root: string, scope: string, entries: GraphLayoutEntry[]) => Promise<void>;

export function createLayoutSaver(root: string, scope: string, save: SaveLayout) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: GraphLayoutEntry[] = [];
  let active: Promise<void> | null = null;

  const drain = () => {
    if (active) return active;
    const draining = (async () => {
      while (latest.length > 0) {
        const entries = latest;
        latest = [];
        await save(root, scope, entries).catch((error) => {
          console.error("сохранение layout:", error);
          throw error;
        });
      }
    })();
    active = draining;
    const reset = () => {
      if (active === draining) active = null;
    };
    void draining.then(reset, reset);
    return draining;
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
      timer = setTimeout(() => { void flush().catch(() => {}); }, 500);
    },
    flush,
    dispose() {
      void flush().catch(() => {});
    },
  };
}
