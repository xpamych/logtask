import { For, Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { BacklinkDto, PageDto, Settings } from "~/lib/api";
import {
  backlinksGet,
  blockCreate,
  blockDelete,
  followLink,
  pageDelete,
  pageGet,
  pageRename,
  pageRevealInFiles,
  taskSetStatus,
} from "~/lib/api";
import { formatJournalName } from "~/lib/text";
import { splitBacklinks } from "~/lib/backlinks";
import { focusMatchesPage } from "~/lib/focus";
import { fitTextarea } from "~/lib/textarea";
import { refreshGuarded, setEditingBlock, setPendingEdit } from "~/lib/editState";
import { IconStar } from "~/components/icons";
import { BlockView } from "./BlockView";
import { RichText } from "./RichText";

export function PageView(props: {
  name: string;
  onOpenPage: (name: string, uuid?: string) => void;
  refreshKey: number;
  focusUuid?: string | null;
  settings?: Settings | null;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** вызывается после успешного переименования страницы */
  onRename?: (newName: string) => void;
  /** вызывается после удаления страницы (навигация прочь — забота родителя) */
  onDeleted?: () => void;
}): JSX.Element {
  const [page, setPage] = createSignal<PageDto | null>(null);
  const [backlinks, setBacklinks] = createSignal<BacklinkDto[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  // виртуальная страница: файла нет, но есть ссылки на неё (как в Logseq)
  const [virtual, setVirtual] = createSignal(false);
  // инлайн-редактор первой записи на пустой странице: открывается по клику
  // на «Страница пуста», Enter/blur сохраняет, Escape отменяет
  const [composing, setComposing] = createSignal(false);
  let composerEl: HTMLTextAreaElement | undefined;
  // инлайн-переименование страницы по клику на заголовок
  const [renaming, setRenaming] = createSignal(false);
  const [renameDraft, setRenameDraft] = createSignal("");
  const [renameBusy, setRenameBusy] = createSignal(false);
  // позиция выпадающего меню страницы (⋯ справа в заголовке)
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);

  const onReveal = async () => {
    try {
      await pageRevealInFiles(props.name);
    } catch (e) {
      setError(String(e));
    }
  };

  const onDeletePage = async () => {
    if (!confirm(`Удалить страницу «${props.name}»? Файл будет стёрт с диска.`)) return;
    try {
      await pageDelete(props.name);
      props.onDeleted?.();
    } catch (e) {
      setError(String(e));
    }
  };
  let renameCancel = false;
  let renameInputEl: HTMLInputElement | undefined;
  let mainEl: HTMLElement | undefined;

  const openComposer = () => {
    setComposing(true);
    queueMicrotask(() => {
      if (!composerEl) return;
      composerEl.focus();
      fitTextarea(composerEl);
    });
  };

  // keepOpen (Enter): блок сохраняется, редактор очищается и остаётся
  // открытым для следующей записи; blur/Escape закрывают редактор
  const submitComposer = async (keepOpen: boolean) => {
    const text = (composerEl?.value ?? "").trim();
    if (!text) {
      setComposing(false);
      return;
    }
    try {
      await blockCreate(props.name, text, null);
      await load();
      if (keepOpen && composerEl) {
        composerEl.value = "";
        composerEl.focus();
      } else {
        setComposing(false);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitComposer(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setComposing(false);
    }
  };

  const startRename = () => {
    setRenameDraft(props.name);
    setRenaming(true);
    renameCancel = false;
    queueMicrotask(() => {
      renameInputEl?.focus();
      renameInputEl?.select();
    });
  };

  const commitRename = async () => {
    const newName = renameDraft().trim();
    if (!newName || newName === props.name) {
      setRenaming(false);
      return;
    }
    if (renameBusy()) return;
    setRenameBusy(true);
    try {
      await pageRename(props.name, newName);
      setRenaming(false);
      props.onRename?.(newName);
    } catch (e) {
      // остаёмся в режиме редактирования, ошибка видна сверху
      setError(String(e));
    } finally {
      setRenameBusy(false);
    }
  };

  const load = async () => {
    setError(null);
    setVirtual(false);
    try {
      const isJournal = /^\d{4}_\d{2}_\d{2}$/.test(props.name);
      let p = isJournal ? await pageGet(props.name) : null;
      if (p === null) {
        p = (await followLink(props.name)) ?? null;
      }
      if (p === null) {
        // страница-ссылка без файла: открываем виртуальную страницу
        // с обратными ссылками, а не ошибку
        setVirtual(true);
        setPage({ name: props.name, kind: "page", blocks: [], preamble: [] });
        setBacklinks(await backlinksGet(props.name));
        return;
      }
      setPage(p);
      setBacklinks(await backlinksGet(props.name));
    } catch (e) {
      setError(String(e));
    }
  };

  /// прокручивает к блоку и подсвечивает его
  const focusBlock = (uuid: string) => {
    const el = mainEl?.querySelector(`[data-uuid="${uuid}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
      el.classList.add("block-focus");
      window.setTimeout(() => el.classList.remove("block-focus"), 2200);
    }
  };

  const onStatusChange = async (uuid: string, marker: string) => {
    try {
      await taskSetStatus(uuid, marker);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const onDelete = async (uuid: string) => {
    try {
      await blockDelete(uuid);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  /// переход кареткой из редактора блока к соседнему (стрелка вверх/вниз):
  /// сосед входит в редактирование, курсор — в его начало или конец
  const onBlockNavigate = (uuid: string, dir: -1 | 1): boolean => {
    const list = page()?.blocks ?? [];
    const i = list.findIndex((x) => x.uuid === uuid);
    const neighbor = i >= 0 ? list[i + dir] : undefined;
    if (!neighbor) return false;
    setEditingBlock(neighbor.uuid);
    setPendingEdit({
      uuid: neighbor.uuid,
      at: dir === 1 ? 0 : neighbor.source.length,
    });
    return true;
  };

  // последний сфокусированный блок: повторный скролл к нему не нужен
  let lastFocused: string | null = null;

  createEffect(() => {
    void props.name;
    lastFocused = null;
    void load();
  });

  // фокус на блоке: только при смене props.focusUuid; перезагрузка
  // страницы по graph-changed повторный скролл не вызывает
  createEffect(() => {
    const id = props.focusUuid;
    if (!id || id === lastFocused) return;
    // страница ещё грузится или видна предыдущая — ждём нужный источник
    if (!focusMatchesPage(page()?.name ?? null, props.name)) return;
    lastFocused = id;
    queueMicrotask(() => focusBlock(id));
  });

  // перезагрузка при изменении графа (watcher): во время редактирования
  // блока откладывается, чтобы не затирать черновик
  const guardedLoad = refreshGuarded(() => void load());
  let lastKey = props.refreshKey;
  createEffect(() => {
    if (props.refreshKey !== lastKey) {
      lastKey = props.refreshKey;
      guardedLoad();
    }
  });

  const linked = () => splitBacklinks(backlinks());

  return (
    <main class="journal" ref={mainEl}>
      <Show when={error()}>
        {(e) => <div class="error">{e()}</div>}
      </Show>
      <Show when={page()}>
        {(p) => (
          <section class="day">
            <h2 class="day-title">
              <Show
                when={renaming()}
                fallback={
                  <Show
                    when={p().kind !== "journal" && !virtual()}
                    fallback={
                      <span>
                        {p().kind === "journal" ? formatJournalName(p().name) : p().name}
                      </span>
                    }
                  >
                    <span
                      class="page-title-name"
                      title="Переименовать страницу"
                      onClick={startRename}
                    >
                      {p().name}
                    </span>
                  </Show>
                }
              >
                <input
                  ref={renameInputEl}
                  class="page-title-input"
                  value={renameDraft()}
                  disabled={renameBusy()}
                  onInput={(e) => setRenameDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename();
                    } else if (e.key === "Escape") {
                      renameCancel = true;
                      setRenaming(false);
                    }
                  }}
                  onBlur={() => {
                    if (renameCancel) {
                      renameCancel = false;
                      return;
                    }
                    if (renaming()) void commitRename();
                  }}
                />
              </Show>
              <Show when={props.onToggleFavorite}>
                <button
                  class="star-btn"
                  classList={{ active: props.favorite ?? false }}
                  title={props.favorite ? "Убрать из избранного" : "В избранное"}
                  onClick={() => props.onToggleFavorite?.()}
                >
                  <IconStar size={18} filled={props.favorite ?? false} />
                </button>
              </Show>
              <Show when={!virtual()}>
                <button
                  class="star-btn page-menu-btn"
                  title="Действия со страницей"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    // правый край меню — по кнопке, ширину считает CSS
                    setMenuPos(menuPos() ? null : { x: r.right, y: r.bottom + 4 });
                  }}
                >
                  ⋯
                </button>
              </Show>
            </h2>
            <Show when={menuPos()}>
              {(pos) => (
                <>
                  <div
                    class="menu-backdrop"
                    onClick={() => setMenuPos(null)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuPos(null);
                    }}
                  />
                  <div
                    class="block-menu ctx-menu page-menu"
                    style={{
                      left: "auto",
                      right: `${window.innerWidth - pos().x}px`,
                      top: `${pos().y}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      class="page-menu-item"
                      onClick={() => {
                        setMenuPos(null);
                        void onReveal();
                      }}
                    >
                      Открыть в файловом менеджере
                    </button>
                    <button
                      class="page-menu-item danger"
                      onClick={() => {
                        setMenuPos(null);
                        void onDeletePage();
                      }}
                    >
                      Удалить страницу
                    </button>
                  </div>
                </>
              )}
            </Show>
            <Show when={p().preamble.length > 0}>
              <div class="page-preamble">
                <RichText text={p().preamble.join("\n")} onOpenPage={props.onOpenPage} />
              </div>
            </Show>
            <For each={p().blocks}>
              {(block) => (
                <BlockView
                  block={block}
                  onOpenPage={props.onOpenPage}
                  onChanged={load}
                  onStatusChange={onStatusChange}
                  onDelete={onDelete}
                  onNavigate={onBlockNavigate}
                  settings={props.settings}
                />
              )}
            </For>
            <Show when={virtual() && p().blocks.length === 0}>
              <div class="placeholder">
                Страница ещё не создана — ниже блоки, где она упоминается
              </div>
            </Show>
            <Show when={!virtual()}>
              <Show
                when={composing()}
                fallback={
                  <Show when={p().blocks.length === 0}>
                    <button
                      class="placeholder placeholder-btn"
                      title="Нажмите, чтобы добавить запись"
                      onClick={openComposer}
                    >
                      Страница пуста
                    </button>
                  </Show>
                }
              >
                <div class="block composer-row">
                  <span class="status-prio-dot empty" />
                  <textarea
                    ref={composerEl}
                    class="block-edit"
                    placeholder="Новая запись…"
                    rows={1}
                    onInput={(e) => fitTextarea(e.currentTarget)}
                    onKeyDown={onComposerKeyDown}
                    onBlur={() => void submitComposer(false)}
                  />
                </div>
              </Show>
            </Show>
          </section>
        )}
      </Show>
      <Show when={linked().tasks.length > 0}>
        <details class="backlinks" open>
          <summary class="backlinks-toggle">
            <span class="backlinks-title">Связанные задачи ({linked().tasks.length})</span>
          </summary>
          <div class="backlinks-list">
            <For each={linked().tasks}>
              {(item) => (
                <button
                  type="button"
                  class="backlink"
                  onClick={() => props.onOpenPage(item.page, item.uuid)}
                >
                  <Show when={item.status}>
                    {(status) => <span class="backlink-status">{status()}</span>}
                  </Show>
                  <span class="backlink-from">{item.page}</span>
                  <span class="backlink-text">
                    <RichText text={item.text} />
                  </span>
                </button>
              )}
            </For>
          </div>
        </details>
      </Show>
      <Show when={linked().links.length > 0}>
        <details class="backlinks" open>
          <summary class="backlinks-toggle">
            <span class="backlinks-title">Обратные ссылки ({linked().links.length})</span>
          </summary>
          <div class="backlinks-list">
            <For each={linked().links}>
              {(item) => (
                <button
                  type="button"
                  class="backlink"
                  onClick={() => props.onOpenPage(item.page, item.uuid)}
                >
                  <span class="backlink-from">{item.page}</span>
                  <span class="backlink-text">
                    <RichText text={item.text} />
                  </span>
                </button>
              )}
            </For>
          </div>
        </details>
      </Show>
    </main>
  );
}
