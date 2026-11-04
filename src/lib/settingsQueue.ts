type Snapshot<T> = { value: T; root: string; sequence: number };

export class SettingsWriteQueue<T> {
  private graph: string | null = null;
  private pending: Snapshot<T> | null = null;
  private running = false;
  private draining: Promise<void> | null = null;
  private sequence = 0;

  private readonly save: (value: T, root: string) => Promise<void>;
  private readonly onSettled?: (sequence: number, error: unknown) => void;

  constructor(
    save: (value: T, root: string) => Promise<void>,
    onSettled?: (sequence: number, error: unknown) => void,
  ) {
    this.save = save;
    this.onSettled = onSettled;
  }

  setGraph(root: string): void {
    this.graph = root;
    this.pending = null;
  }

  enqueue(root: string, value: T): number {
    const sequence = ++this.sequence;
    if (root !== this.graph) return sequence;
    this.pending = { value, root, sequence };
    if (!this.running) {
      this.running = true;
      this.draining = this.drain();
    }
    return sequence;
  }

  pendingSnapshot(): T | null {
    return this.pending?.value ?? null;
  }

  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = null;
        try {
          await this.save(next.value, next.root);
          this.onSettled?.(next.sequence, null);
        } catch (error) {
          this.onSettled?.(next.sequence, error);
        }
      }
    } finally {
      this.running = false;
      this.draining = null;
      if (this.pending) {
        this.running = true;
        this.draining = this.drain();
      }
    }
  }
}
