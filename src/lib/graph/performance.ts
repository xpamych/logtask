import type { GraphViewSettings } from "~/lib/api";

export class QualityController {
  level = 0;
  private samples = 0;
  private total = 0;
  private slow = 0;
  private fast = 0;

  sample(frameMs: number) {
    if (!Number.isFinite(frameMs) || frameMs < 0) return this.level;
    this.samples += 1;
    this.total += frameMs;
    if (this.samples < 30) return this.level;
    const average = this.total / this.samples;
    this.samples = 0;
    this.total = 0;
    if (average > 33) {
      this.slow += 1;
      this.fast = 0;
    } else if (average < 20) {
      this.fast += 1;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    if (this.slow >= 2) {
      this.level = Math.min(4, this.level + 1);
      this.slow = 0;
    } else if (this.fast >= 5) {
      this.level = Math.max(0, this.level - 1);
      this.fast = 0;
    }
    return this.level;
  }

  reset() {
    this.level = 0;
    this.samples = 0;
    this.total = 0;
    this.slow = 0;
    this.fast = 0;
  }
}

export function qualityForSettings(settings: GraphViewSettings, level: number): GraphViewSettings {
  return {
    ...settings,
    arrows: level >= 3 ? false : settings.arrows,
    labelThreshold: level >= 2 ? Math.max(1, settings.labelThreshold) : settings.labelThreshold,
    alphaDecay: level >= 1 ? Math.min(0.5, settings.alphaDecay * 1.5) : settings.alphaDecay,
    clusterThreshold: level >= 4 ? 20 : settings.clusterThreshold,
  };
}
