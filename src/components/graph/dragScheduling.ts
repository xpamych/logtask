interface LatestFrameSchedulerOptions {
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
  emit: (x: number, y: number) => void;
}

export function createLatestFrameScheduler({ request, cancel, emit }: LatestFrameSchedulerOptions) {
  let frame: number | null = null;
  let latest: { x: number; y: number } | null = null;
  let disposed = false;

  const emitLatest = () => {
    if (disposed || !latest) return;
    const point = latest;
    latest = null;
    emit(point.x, point.y);
  };

  return {
    schedule(x: number, y: number) {
      if (disposed) return;
      latest = { x, y };
      if (frame !== null) return;
      frame = request(() => {
        frame = null;
        emitLatest();
      });
    },
    flush() {
      if (frame !== null) {
        cancel(frame);
        frame = null;
      }
      emitLatest();
    },
    dispose() {
      if (frame !== null) cancel(frame);
      frame = null;
      latest = null;
      disposed = true;
    },
  };
}
