import { For, Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto } from "~/lib/api";
import { backlinksGet, followLink, pageGet } from "~/lib/api";
import { formatJournalName } from "~/lib/text";
import { BlockView } from "./BlockView";

export function PageView(props: {
  name: string;
  onOpenPage: (name: string) => void;
  refreshKey: number;
  focusUuid?: string | null;
}): JSX.Element {
  const [page, setPage] = createSignal<PageDto | null>(null);
  const [backlinks, setBacklinks] = createSignal<[string, string][]>([]);
  const [open, setOpen] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let mainEl: HTMLElement | undefined;

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
      if (props.focusUuid) {
        queueMicrotask(() => focusBlock(props.focusUuid!));
      }
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

  createEffect(() => {
    void props.name;
    void props.refreshKey;
    void load();
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
            </h2>
            <For each={p().blocks}>
              {(block) => <BlockView block={block} onOpenPage={props.onOpenPage} />}
            </For>
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
