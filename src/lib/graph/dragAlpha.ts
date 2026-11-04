export function nextDragAlpha(currentAlpha: number, alphaMin: number, wakeAlpha = 0.7): number {
  return currentAlpha < alphaMin ? wakeAlpha : currentAlpha;
}
