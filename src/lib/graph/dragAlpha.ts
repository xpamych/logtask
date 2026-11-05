export function nextDragAlpha(currentAlpha: number, alphaMin: number, wakeAlpha = 0.3): number {
  return currentAlpha < alphaMin ? wakeAlpha : currentAlpha;
}
