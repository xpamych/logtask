import { createSignal } from "solid-js";

export const [selectedTaskUuid, setSelectedTaskUuid] = createSignal<string | null>(null);

export function visibleTaskUuid(
  elements: readonly HTMLElement[],
  direction: 1 | -1,
  current: string | null,
): string | null {
  const visible = elements.filter((element) => element.offsetParent !== null && element.dataset.taskUuid);
  if (visible.length === 0) return null;
  const currentIndex = visible.findIndex((element) => element.dataset.taskUuid === current);
  if (currentIndex === -1) return visible[direction === 1 ? 0 : visible.length - 1].dataset.taskUuid!;
  const nextIndex = Math.max(0, Math.min(visible.length - 1, currentIndex + direction));
  return visible[nextIndex].dataset.taskUuid!;
}

export function primaryTaskElement(
  elements: readonly HTMLElement[],
  uuid: string,
): HTMLElement | null {
  return elements.find((element) => element.offsetParent !== null && element.dataset.taskUuid === uuid) ?? null;
}
