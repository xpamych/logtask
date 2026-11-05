export interface CameraMotionState {
  x: number;
  y: number;
  zoom: number;
}

export function smoothStepAmount(milliseconds: number, seconds: number): number {
  if (milliseconds <= 0) return 0;
  if (milliseconds >= 1000) return 1;
  return 1 - Math.exp(-milliseconds / (seconds * 1000));
}

export function interpolateValue(
  current: number,
  target: number,
  milliseconds: number,
  seconds: number,
): number {
  return current + (target - current) * smoothStepAmount(milliseconds, seconds);
}

export function transitionAlpha(
  current: number,
  target: number,
  milliseconds: number,
  seconds: number,
  immediate: boolean,
): { value: number; moving: boolean } {
  if (immediate) return { value: target, moving: false };
  const value = interpolateValue(current, target, milliseconds, seconds);
  if (Math.abs(target - value) < 0.005) return { value: target, moving: false };
  return { value, moving: true };
}

export function zoomCameraTarget(
  camera: CameraMotionState,
  factor: number,
  x: number,
  y: number,
  width: number,
  height: number,
): CameraMotionState {
  const beforeX = (x - width / 2) / camera.zoom + camera.x;
  const beforeY = (y - height / 2) / camera.zoom + camera.y;
  const zoom = Math.max(1 / 128, Math.min(8, camera.zoom * factor));
  return {
    x: beforeX - (x - width / 2) / zoom,
    y: beforeY - (y - height / 2) / zoom,
    zoom,
  };
}


export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1);
  return Math.pow(1.5, -pixels / 120);
}

export function advancePanVelocity(
  velocity: number,
  milliseconds: number,
  reducedMotion: boolean,
): { velocity: number; offset: number } {
  if (reducedMotion || Math.abs(velocity) < 0.001) return { velocity: 0, offset: 0 };
  return { velocity: velocity * Math.pow(0.9, milliseconds / 16), offset: velocity * milliseconds / 1000 };
}
