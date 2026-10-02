import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto, Settings } from "~/lib/api";
import {
  backlinksGet,
  blockCreate,
  blockDelete,
  journalList,
  journalPrev,
  pageGet,
  taskSetStatus,
} from "~/lib/api";
import { formatJournalName, journalLogseqTitle } from "~/lib/text";
import { refreshGuarded } from "~/lib/editState";
import { BlockView } from "./BlockView";
import { RichText } from "./RichText";

const PAGE_SIZE = 5;

export function JournalTape(props: {
  onOpenPage: (name: string) => void;
  refreshKey: number;
  settings?: Settings | null;
}): JSX.Element {
  const [days, setDays] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<Record<string, PageDto>>({});
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // поколение загрузки: защита от гонки reload'ов (старт + graph-changed
  // от watcher'а) — устаревший reload не должен дописывать свои дни
  let epoch = 0;

  const loadDay = async (name: string, my: number): Promise<PageDto> => {
    let page = pages()[name];
    if (!page) {
      const fetched = await pageGet(name);
      if (my !== epoch) return fetched;
      page = fetched;
      setPages((prev) => ({ ...prev, [name]: fetched }));
    }
    return page;
  };

  const appendDays = async (names: string[], my: number) => {
    if (my !== epoch) return;
    if (names.length === 0) {
      setDone(true);
      return;
    }
    setLoading(true);
    try {
      for (const name of names) {
        if (my !== epoch) return;
        await loadDay(name, my);
      }
      if (my !== epoch) return;
      // на всякий случай отсекаем дни, которые уже есть в ленте
      setDays((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);
      // если лента всё ещё не заполняет экран — догружаем следующую порцию
      requestAnimationFrame(maybeLoadMore);
    } catch (e) {
      if (my === epoch) setError(String(e));
    } finally {
      if (my === epoch) setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loading() || done()) return;
    const oldest = days()[days().length - 1];
    if (!oldest) return;
    const my = epoch;
    const older = await journalPrev(oldest, PAGE_SIZE);
    await appendDays(older, my);
  };

  const reload = async () => {
    const my = ++epoch;
    setError(null);
    setDays([]);
    setPages({});
    setDone(false);
    setLoading(false);
    let journals: string[];
    try {
      journals = await journalList();
    } catch (e) {
      if (my === epoch) setError(String(e));
      return;
    }
    if (my !== epoch) return;
    if (journals.length === 0) {
      setError("журналов не найдено");
      return;
    }
    await appendDays(journals.slice(0, PAGE_SIZE), my);
  };

  const onStatusChange = async (uuid: string, marker: string) => {
    try {
      await taskSetStatus(uuid, marker);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const onDelete = async (uuid: string) => {
    try {
      await blockDelete(uuid);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  // инлайн-редактор новой записи в пустом дне: открывается по клику
  // на «В этот день записей нет», Enter/blur сохраняет, Escape отменяет
  const [composerDay, setComposerDay] = createSignal<string | null>(null);
  let composerEl: HTMLTextAreaElement | undefined;

  const openComposer = (day: string) => {
    setComposerDay(day);
    queueMicrotask(() => composerEl?.focus());
  };

  const submitComposer = async () => {
    const day = composerDay();
    if (!day) return;
    const text = (composerEl?.value ?? "").trim();
    setComposerDay(null);
    if (!text) return;
    try {
      await blockCreate(day, text, null);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitComposer();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setComposerDay(null);
    }
  };

  onMount(reload);

  // бесконечная подгрузка: следим за скроллом самой ленты (.journal —
  // скролл-контейнер) и догружаем дни, когда до низа остаётся < 300px
  let mainEl: HTMLElement | undefined;

  const maybeLoadMore = () => {
    if (!mainEl) return;
    if (mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 300) {
      void loadMore();
    }
  };

  // блоки дня без служебной строки-заголовка ("Sep 30th, 2026"), которую
  // Logtask пишет в новый журнал: дата уже есть в заголовке дня
  const tapeBlocks = (page: PageDto) => {
    const first = page.blocks[0];
    if (
      page.kind === "journal" &&
      first &&
      first.content.trim() === journalLogseqTitle(page.name)
    ) {
      return page.blocks.slice(1);
    }
    return page.blocks;
  };

  // перезагрузка при изменении графа (watcher): во время редактирования
  // блока откладывается, чтобы не затирать черновик
  const guardedReload = refreshGuarded(() => void reload());
  let lastKey = -1;
  createEffect(() => {
    if (props.refreshKey !== lastKey) {
      lastKey = props.refreshKey;
      if (lastKey > 0) guardedReload();
    }
  });

  return (
    <main class="journal" ref={mainEl} onScroll={maybeLoadMore}>
      <Show when={error()}>
        {(e) => <div class="error">{e()}</div>}
      </Show>
      <For each={days()}>
        {(name) => (
          <section class="day">
            <h2 class="day-title">{formatJournalName(name)}</h2>
            <Show when={pages()[name]} fallback={<div class="placeholder">…</div>}>
              {(page) => (
                <>
                  <For each={tapeBlocks(page())}>
                    {(block) => (
                      <BlockView
                        block={block}
                        onOpenPage={props.onOpenPage}
                        onChanged={reload}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                        settings={props.settings}
                      />
                    )}
                  </For>
                  <Show when={tapeBlocks(page()).length === 0}>
                    <Show
                      when={composerDay() === name}
                      fallback={
                        <button
                          class="placeholder placeholder-btn"
                          title="Нажмите, чтобы добавить запись"
                          onClick={() => openComposer(name)}
                        >
                          В этот день записей нет
                        </button>
                      }
                    >
                      <textarea
                        ref={composerEl}
                        class="block-edit day-composer"
                        placeholder="Новая запись…"
                        rows={1}
                        onKeyDown={onComposerKeyDown}
                        onBlur={() => void submitComposer()}
                      />
                    </Show>
                  </Show>
                  <BacklinksPanel name={name} />
                </>
              )}
            </Show>
          </section>
        )}
      </For>
      <div class="tape-sentinel">
        {loading() ? "Загрузка…" : done() && days().length > 0 ? "Это все журналы" : ""}
      </div>
    </main>
  );
}

function BacklinksPanel(props: { name: string }): JSX.Element {
  const [links, setLinks] = createSignal<[string, string][]>([]);
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    void props.name;
    backlinksGet(props.name).then(setLinks).catch(() => setLinks([]));
  });

  return (
    <Show when={links().length > 0}>
      <div class="backlinks">
        <button class="backlinks-toggle" onClick={() => setOpen((v) => !v)}>
          <span class="caret">{open() ? "▾" : "▸"}</span>
          <span class="backlinks-title">Ссылки на эту страницу ({links().length})</span>
        </button>
        <Show when={open()}>
          <div class="backlinks-list">
            <For each={links()}>
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
  );
}
