import { For, Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { PageDto } from "~/lib/api";
import { followLink, pageGet } from "~/lib/api";
import { formatJournalName, todayJournalName } from "~/lib/text";
import { RichText } from "./RichText";

const JOURNAL_RE = /^\d{4}_\d{2}_\d{2}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

interface TocEntry {
  level: number;
  text: string;
  uuid: string;
}

/** Заголовки #..###### из контента блока и строк-продолжений
 *  (внутри код-заборов ``` не ищем) */
function collectHeadings(p: PageDto): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const b of p.blocks) {
    let inCode = false;
    for (const line of [b.content, ...b.extra]) {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const h = HEADING_RE.exec(line);
      if (h) entries.push({ level: h[1].length, text: h[2], uuid: b.uuid });
    }
  }
  return entries;
}

/** Оглавление правой панели: markdown-заголовки открытой страницы.
 *  В режиме журнала — заголовки сегодняшнего дня.
 *  Клик по строке — переход к блоку с заголовком (с подсветкой). */
export function Contents(props: {
  /** открытая страница; null в режиме журнала → берём сегодняшний день */
  page: string | null;
  refreshKey: number;
  onOpenPage: (name: string, uuid?: string) => void;
}): JSX.Element {
  const [page, setPage] = createSignal<PageDto | null>(null);
  const [missing, setMissing] = createSignal(false);

  const target = () => props.page ?? todayJournalName();

  const load = async () => {
    try {
      const name = target();
      let p = JOURNAL_RE.test(name) ? await pageGet(name) : null;
      p ??= (await followLink(name)) ?? null;
      setMissing(p === null);
      setPage(p);
    } catch (e) {
      console.error("оглавление:", e);
      setMissing(true);
      setPage(null);
    }
  };

  createEffect(() => {
    void props.refreshKey;
    void target();
    void load();
  });

  const headings = () => {
    const p = page();
    return p ? collectHeadings(p) : [];
  };

  // нормализация отступов: самый крупный заголовок страницы — без отступа
  const minLevel = () => Math.min(...headings().map((h) => h.level));

  return (
    <div class="contents">
      <Show
        when={page()}
        fallback={
          <div class="placeholder">
            {missing()
              ? props.page
                ? "Оглавления нет"
                : "Записей сегодня нет"
              : "Загрузка…"}
          </div>
        }
      >
        {(p) => (
          <>
            <div class="contents-title" title={p().name}>
              {JOURNAL_RE.test(p().name) ? formatJournalName(p().name) : p().name}
            </div>
            <Show
              when={headings().length > 0}
              fallback={<div class="placeholder">Заголовков нет</div>}
            >
              <For each={headings()}>
                {(h) => (
                  <button
                    class={`contents-item contents-h${h.level}`}
                    style={{
                      "padding-left": `${8 + (h.level - minLevel()) * 14}px`,
                    }}
                    title={h.text}
                    onClick={() => props.onOpenPage(p().name, h.uuid)}
                  >
                    <span class="contents-text">
                      <RichText text={h.text} />
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
