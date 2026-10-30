import { createSignal } from "solid-js";

export type ModalContext = "palette" | "help" | "taskMenu" | "capture";

const [stack, setStack] = createSignal<ModalContext[]>([]);

export const activeModalContext = () => stack()[stack().length - 1] ?? null;

export function pushModalContext(context: ModalContext): () => void {
  setStack((items) => [...items, context]);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    setStack((items) => {
      const index = items.lastIndexOf(context);
      return index === -1 ? items : items.filter((_, i) => i !== index);
    });
  };
}
