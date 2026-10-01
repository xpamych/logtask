import { For, Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto, Settings } from "~/lib/api";
import {
  backlinksGet,
  blockCreate,
  blockDelete,
  followLink,
  pageGet,
  taskSetStatus,
} from "~/lib/api";
import { formatJournalName } from "~/lib/text";
import { refreshGuarded } from "~/lib/editState";
import { BlockView } from "./BlockView";

export function PageView(props: {
  name: string;
  onOpenPage: (name: string) => void;
  refreshKey: number;
  focusUuid?: string | null;
  settings?: Settings | null;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}): JSX.Element {
  const [page, setPage] = createSignal<PageDto | null>(null);
  const [backlinks, setBacklinks] = createSignal<[string, string][]>([]);
  const [open, setOpen] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [newText, setNewText] = createSignal("");
  let mainEl: HTMLElement | undefined;
  let addInputEl: HTMLInputElement | undefined;

  const load = async () => {
    setError(null);
    try {
      const isJournal = /^\d{4}_\d{2}_\d{2}$/.test(props.name);
      let p = isJournal ? await pageGet(props.name) : null;
      if (p === null) {
        p = (await followLink(props.name)) ?? null;
      }
      if (p === null) {
        setError(`страница «${props.name}» не найдена`);
        setPage(null);
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
              {p().kind === "journal" ? formatJournalName(p().name) : p().name}
              <Show when={props.onToggleFavorite}>
                <button
                  class="star-btn"
                  classList={{ active: props.favorite ?? false }}
                  title={props.favorite ? "Убрать из избранного" : "В избранное"}
                  onClick={() => props.onToggleFavorite?.()}
                >
                  {props.favorite ? "★" : "☆"}
                </button>
              </Show>
            </h2>
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
            <Show when={p().blocks.length === 0}>
              <div class="placeholder">Страница пуста</div>
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
                    <span class="backlink-text">{text}</span>
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
