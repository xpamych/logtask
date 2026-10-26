export class LatestSnapshotLoader<T> {
  private loading = false;
  private pending = false;
  private generation = 0;

  private readonly load: () => Promise<T>;
  private readonly apply: (value: T) => void;

  constructor(load: () => Promise<T>, apply: (value: T) => void) {
    this.load = load;
    this.apply = apply;
  }

  request() {
    this.generation += 1;
    if (this.loading) {
      this.pending = true;
      return;
    }
    this.loading = true;
    void this.run();
  }

  private async run() {
    const started = performance.now();
    do {
      this.pending = false;
      const generation = this.generation;
      try {
        const value = await this.load();
        if (generation === this.generation) this.apply(value);
      } catch (error) {
        if (generation === this.generation) console.error("обновление графа:", error);
      }
    } while (this.pending);
    this.loading = false;
    const elapsed = performance.now() - started;
    if (elapsed > 5000) console.warn(`Обновление графа заняло ${Math.round(elapsed)} мс`);
  }

  invalidate() {
    this.generation += 1;
    this.pending = false;
  }
}
