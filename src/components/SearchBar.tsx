import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { SearchHit } from "~/lib/api";
import { pageCreate, search } from "~/lib/api";
import { RichText } from "./RichText";

/** Строка поиска по страницам и блокам — вверху центрального окна */
export function SearchBar(props: {
  onOpenPage: (name: string) => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [error, setError] = createSignal("");

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  // поколение запроса: устаревший in-flight search не перезапишет свежие hits
  let searchGen = 0;

  onCleanup(() => {
    if (searchTimer !== undefined) clearTimeout(searchTimer);
  });

  const onQuery = (value: string) => {
    setQuery(value);
    setError("");
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    const gen = ++searchGen;
    if (!value.trim()) {
      setHits([]);
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const found = await search(value);
        if (gen === searchGen) setHits(found);
      } catch {
        if (gen === searchGen) setHits([]);
      }
    }, 120);
  };

  const reset = () => {
    setQuery("");
    setHits([]);
    setError("");
  };

  const pick = (page: string) => {
    props.onOpenPage(page);
    reset();
  };

  /** Есть ли в графе страница с именем, точно совпадающим с запросом */
  const exactMatch = (): boolean => {
    const q = query().trim().toLowerCase();
    return hits().some((h) => h.kind === "page" && h.page.toLowerCase() === q);
  };

  const create = async () => {
    const name = query().trim();
    if (!name) return;
    try {
      const page = await pageCreate(name);
      pick(page.name);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div class="searchbar">
      <input
        type="search"
        placeholder="Поиск страниц и блоков…"
        value={query()}
        onInput={(e) => onQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            reset();
          } else if (e.key === "Enter" && !exactMatch()) {
            void create();
          }
        }}
      />
      <Show when={query().trim()}>
        <div class="searchbar-results">
          <Show when={hits().length === 0 && !error()}>
            <div class="searchbar-empty">Ничего не найдено</div>
          </Show>
          <For each={hits().slice(0, 40)}>
            {(hit) => (
              <button class="search-hit" onClick={() => pick(hit.page)}>
                <span class="search-hit-page">{hit.page}</span>
                <span class="search-hit-text">
                  <RichText text={hit.text.trim().slice(0, 90)} />
                </span>
              </button>
            )}
          </For>
          <Show when={error()}>
            <div class="searchbar-empty">{error()}</div>
          </Show>
          <Show when={!exactMatch()}>
            <button class="search-hit search-create" onClick={() => void create()}>
              <span class="search-hit-page">
                + Создать страницу «{query().trim()}»
              </span>
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
