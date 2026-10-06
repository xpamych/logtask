import { createEffect, createSignal, untrack } from "solid-js";

/** uuid блока, который сейчас редактируется (null — никто) */
export const [editingBlock, setEditingBlock] = createSignal<string | null>(null);

/**
 * Продолжение редактирования после склейки блоков: при merge uuid выжившего
 * блока пересоздаётся, страница перезагружается, и новый экземпляр BlockView
 * по этой записи входит в режим редактирования и ставит курсор в точку
 * склейки. `at` — абсолютная позиция (склейка вниз), `minus` — «длина первой
 * строки минус N» (склейка вверх: стык виден только после перезагрузки).
 */
export const [pendingEdit, setPendingEdit] = createSignal<{
  uuid: string;
  at?: number;
  minus?: number;
} | null>(null);

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
