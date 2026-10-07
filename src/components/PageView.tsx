import { For, Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto, Settings } from "~/lib/api";
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
import { refreshGuarded } from "~/lib/editState";
import { IconStar } from "~/components/icons";
import { BlockView } from "./BlockView";
import { RichText } from "./RichText";

export function PageView(props: {
  name: string;
  onOpenPage: (name: string) => void;
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
  const [backlinks, setBacklinks] = createSignal<[string, string][]>([]);
  const [open, setOpen] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  // виртуальная страница: файла нет, но есть ссылки на неё (как в Logseq)
  const [virtual, setVirtual] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [newText, setNewText] = createSignal("");
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
  let addInputEl: HTMLInputElement | undefined;

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

  const createBlock = async () => {
    const text = newText().trim();
    if (!text) {
      setAdding(false);
      return;
    }
    try {
      await blockCreate(props.name, text, "TODO");
      setNewText("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(String(e));
    }
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
    // страница ещё грузится — эффект перезапустится на setPage
    if (!page()) return;
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
                    setMenuPos(menuPos() ? null : { x: r.right - 180, y: r.bottom + 4 });
                  }}
                >
                  ⋯
                </button>
              </Show>
            </h2>
            <Show when={menuPos()}>
              {(pos) => (
                <>
                  <div class="menu-backdrop" onClick={() => setMenuPos(null)} />
                  <div
                    class="block-menu ctx-menu"
                    style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      class="block-menu-item"
                      onClick={() => {
                        setMenuPos(null);
                        void onReveal();
                      }}
                    >
                      Открыть в файловом менеджере
                    </button>
                    <button
                      class="block-menu-item danger"
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
                  settings={props.settings}
                />
              )}
            </For>
            <Show when={!virtual()}>
              <Show when={adding()}>
                <div class="block-add-row">
                  <input
                    ref={addInputEl}
                    class="block-add-input"
                    placeholder="новая задача…"
                    value={newText()}
                    onInput={(e) => setNewText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createBlock();
                      } else if (e.key === "Escape") {
                        setAdding(false);
                        setNewText("");
                      }
                    }}
                    onBlur={() => void createBlock()}
                  />
                </div>
              </Show>
              <button class="block-add-btn" onClick={() => {
                setAdding(true);
                queueMicrotask(() => addInputEl?.focus());
              }}>
                ＋ добавить блок
              </button>
            </Show>
            <Show when={p().blocks.length === 0}>
              <div class="placeholder">
                {virtual()
                  ? "Страница ещё не создана — ниже блоки, где она упоминается"
                  : "Страница пуста"}
              </div>
            </Show>
          </section>
        )}
      </Show>
      <Show when={backlinks().length > 0}>
        <div class="backlinks">
          <button class="backlinks-toggle" onClick={() => setOpen((v) => !v)}>
            <span class="caret">{open() ? "▾" : "▸"}</span>
            <span class="backlinks-title">Ссылки на эту страницу ({backlinks().length})</span>
          </button>
          <Show when={open()}>
            <div class="backlinks-list">
              <For each={backlinks()}>
                {([from, text]) => (
                  <div class="backlink">
                    <span class="backlink-from">{from}</span>
                    <span class="backlink-text">
                      <RichText text={text} />
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </main>
  );
}
