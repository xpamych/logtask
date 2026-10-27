export function hasPointerDragged(startX: number, startY: number, x: number, y: number): boolean {
  return Math.abs(x - startX) + Math.abs(y - startY) > 2;
}

export function shouldClickPointer(moved: boolean, cancelled: boolean): boolean {
  return !moved && !cancelled;
}
