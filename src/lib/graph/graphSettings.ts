import type { GraphViewSettings } from "~/lib/api";

const Q = 0.01;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function obsidianCenterFromSlider(value: number): number {
  const normalized = clamp(value, 0, 1);
  return (Math.pow(Q, 1 - normalized) - Q) / (1 - Q);
}

export function obsidianCenterToSlider(value: number): number {
  const physical = clamp(value, 0, 1);
  return 1 - Math.log(physical * (1 - Q) + Q) / Math.log(Q);
}

export function obsidianRepelFromSlider(value: number): number {
  return Math.pow(clamp(value, 0, 20), 3);
}

export function obsidianRepelToSlider(value: number): number {
  return Math.cbrt(Math.max(0, value));
}

export function migrateGraphSettings(settings: GraphViewSettings): GraphViewSettings {
  return {
    ...settings,
    centerForce: settings.centerForce === 0.12 ? 0.1 : settings.centerForce,
    repelForce: settings.repelForce === 45 ? 1000 : settings.repelForce,
    linkForce: settings.linkForce === 0.75 ? 1 : settings.linkForce,
    linkDistance: settings.linkDistance === 35 ? 250 : settings.linkDistance,
  };
}
