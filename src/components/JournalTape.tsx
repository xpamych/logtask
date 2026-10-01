import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto } from "~/lib/api";
import {
  backlinksGet,
  blockDelete,
  journalList,
  journalPrev,
  pageGet,
  taskSetStatus,
} from "~/lib/api";
import { formatJournalName } from "~/lib/text";
import { BlockView } from "./BlockView";

const PAGE_SIZE = 5;

export function JournalTape(props: {
  onOpenPage: (name: string) => void;
  refreshKey: number;
}): JSX.Element {
  const [days, setDays] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<Record<string, PageDto>>({});
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadDay = async (name: string): Promise<PageDto> => {
    let page = pages()[name];
    if (!page) {
      page = await pageGet(name);
      setPages((prev) => ({ ...prev, [name]: page! }));
    }
    return page!;
  };

  const appendDays = async (names: string[]) => {
    if (names.length === 0) {
      setDone(true);
      return;
    }
    setLoading(true);
    try {
      for (const name of names) {
        await loadDay(name);
      }
      setDays((prev) => [...prev, ...names]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loading() || done()) return;
    const oldest = days()[days().length - 1];
    if (!oldest) return;
    const older = await journalPrev(oldest, PAGE_SIZE);
    await appendDays(older);
  };

  const reload = async () => {
    setDays([]);
    setPages({});
    setDone(false);
    const journals = await journalList();
    if (journals.length === 0) {
      setError("журналов не найдено");
      return;
    }
    await appendDays(journals.slice(0, PAGE_SIZE));
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

  onMount(reload);

  // перезагрузка при изменении графа (watcher)
  let lastKey = -1;
  createEffect(() => {
    if (props.refreshKey !== lastKey) {
      lastKey = props.refreshKey;
      if (lastKey > 0) void reload();
    }
  });

  return (
    <main class="journal">
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
                  <For each={page().blocks}>
                    {(block) => (
                      <BlockView
                        block={block}
                        onOpenPage={props.onOpenPage}
                        onChanged={reload}
                        onStatusChange={onStatusChange}
                        onDelete={onDelete}
                      />
                    )}
                  </For>
                  <Show when={page().blocks.length === 0}>
                    <div class="placeholder">В этот день записей нет</div>
                  </Show>
                  <BacklinksPanel name={name} />
                </>
              )}
            </Show>
          </section>
        )}
      </For>
      <Show when={days().length > 0}>
        <button class="load-more" onClick={loadMore} disabled={loading() || done()}>
          {done() ? "Это все журналы" : loading() ? "Загрузка…" : "Загрузить ещё дней"}
        </button>
      </Show>
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
                  <span class="backlink-text">{text}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
