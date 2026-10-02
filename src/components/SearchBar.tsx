import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { SearchHit } from "~/lib/api";
import { search } from "~/lib/api";
import { RichText } from "./RichText";

/** Строка поиска по страницам и блокам — вверху центрального окна */
export function SearchBar(props: {
  onOpenPage: (name: string) => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  // поколение запроса: устаревший in-flight search не перезапишет свежие hits
  let searchGen = 0;

  onCleanup(() => {
    if (searchTimer !== undefined) clearTimeout(searchTimer);
  });

  const onQuery = (value: string) => {
    setQuery(value);
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

  const pick = (page: string) => {
    props.onOpenPage(page);
    setQuery("");
    setHits([]);
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
            setQuery("");
            setHits([]);
          }
        }}
      />
      <Show when={query().trim()}>
        <div class="searchbar-results">
          <Show when={hits().length === 0}>
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
        </div>
      </Show>
    </div>
  );
}
