import { createEffect, createSignal, untrack } from "solid-js";

/** uuid блока, который сейчас редактируется (null — никто) */
export const [editingBlock, setEditingBlock] = createSignal<string | null>(null);

/**
 * Обёртка для перезагрузки по событию graph-changed: пока пользователь
 * редактирует блок, выполнение откладывается до конца редактирования,
 * чтобы пересоздание BlockView не затирало черновик.
 * Вызывать в теле компонента (создаёт createEffect).
 */
export function refreshGuarded(run: () => void): () => void {
  const [pending, setPending] = createSignal(false);
  createEffect(() => {
    if (editingBlock() === null && pending()) {
      setPending(false);
      untrack(run);
    }
  });
  return () => {
    if (editingBlock() !== null) {
      setPending(true);
    } else {
      run();
    }
  };
}
