import { createEffect, createSignal, untrack } from "solid-js";

/** uuid блока, который сейчас редактируется (null — никто) */
export const [editingBlock, setEditingBlock] = createSignal<string | null>(null);

const [openBlockMenus, setOpenBlockMenus] = createSignal(0);

/** Учитывает открытое меню, чтобы обновление графа не размонтировало его. */
export function trackOpenBlockMenu(): () => void {
  setOpenBlockMenus((count) => count + 1);
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    setOpenBlockMenus((count) => count - 1);
  };
}

/**
 * Продолжение редактирования после склейки блоков: при merge uuid выжившего
 * блока пересоздаётся, страница перезагружается, и новый экземпляр BlockView
 * по этой записи входит в режим редактирования и ставит курсор в точку
 * склейки. Позиция курсора (приоритет сверху вниз):
 * `atLine` — курсор в начало строки N (склейка вниз: первая приклеенная
 * строка), `minusLines` — начало строки «N-я с конца» (склейка вверх: стык
 * виден только после перезагрузки), `at` — абсолютная позиция в символах.
 */
export const [pendingEdit, setPendingEdit] = createSignal<{
  uuid: string;
  at?: number;
  atLine?: number;
  minusLines?: number;
} | null>(null);

/**
 * Обёртка для перезагрузки по событию graph-changed: пока пользователь
 * редактирует блок или держит открытым его меню, выполнение откладывается,
 * чтобы пересоздание BlockView не затирало черновик и не закрыло меню.
 * Вызывать в теле компонента (создаёт createEffect).
 */
export function refreshGuarded(run: () => void): () => void {
  const [pending, setPending] = createSignal(false);
  createEffect(() => {
    if (editingBlock() === null && openBlockMenus() === 0 && pending()) {
      setPending(false);
      untrack(run);
    }
  });
  return () => {
    if (editingBlock() !== null || openBlockMenus() > 0) {
      setPending(true);
    } else {
      run();
    }
  };
}
