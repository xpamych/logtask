import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphSummary, RecentGraph, SearchHit } from "~/lib/api";
import { pickGraphDir, recentGraphs, search } from "~/lib/api";

export function Sidebar(props: {
  summary: GraphSummary | null;
  journals: string[];
  pages: string[];
  onOpenPage: (name: string) => void;
  onOpenSettings: () => void;
  onOpenGraph: (path: string) => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [showPages, setShowPages] = createSignal(true);
  const [recents, setRecents] = createSignal<RecentGraph[]>([]);

  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const loadRecents = async () => {
    try {
      setRecents(await recentGraphs());
    } catch {
      setRecents([]);
    }
  };
  void loadRecents();

  const onPickGraph = async () => {
    const path = await pickGraphDir();
    if (path) props.onOpenGraph(path);
  };

  const onQuery = (value: string) => {
    setQuery(value);
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    if (!value.trim()) {
      setHits([]);
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        setHits(await search(value));
      } catch {
        setHits([]);
      }
    }, 120);
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-search">
        <input
          type="search"
          placeholder="Поиск страниц и блоков…"
          value={query()}
          onInput={(e) => onQuery(e.currentTarget.value)}
        />
        <button
          class="settings-btn"
          title="Открыть другой граф"
          onClick={onPickGraph}
        >
          📂
        </button>
        <button
          class="settings-btn"
          title="Настройки"
          onClick={props.onOpenSettings}
        >
          ⚙
        </button>
      </div>

      <Show when={recents().length > 0}>
        <div class="sidebar-section">
          <div class="sidebar-title">Недавние графы</div>
          <div class="scroll-list">
            <For each={recents().slice(0, 5)}>
              {(g) => (
                <button
                  class="page-item"
                  title={g.path}
                  onClick={() => props.onOpenGraph(g.path)}
                >
                  {g.path.split("/").pop() ?? g.path}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.summary}>
        {(s) => (
          <div class="stats">
            <div class="stat"><span class="stat-num">{s().journals}</span> журналов</div>
            <div class="stat"><span class="stat-num">{s().pages}</span> страниц</div>
            <div class="stat"><span class="stat-num">{s().tasks}</span> задач</div>
            <div class="stat"><span class="stat-num">{s().backlinks}</span> ссылок</div>
          </div>
        )}
      </Show>

      <Show when={props.summary?.root} keyed>
        {(root) => <div class="graph-path" title={root}>{root}</div>}
      </Show>

      <Show when={query().trim()}>
        <div class="sidebar-section">
          <div class="sidebar-title">Найдено ({hits().length})</div>
          <div class="scroll-list">
            <For each={hits().slice(0, 40)}>
              {(hit) => (
                <button class="search-hit" onClick={() => props.onOpenPage(hit.page)}>
                  <span class="search-hit-page">{hit.page}</span>
                  <span class="search-hit-text">{hit.text.trim().slice(0, 90)}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={!query().trim()}>
        <nav class="sidebar-section">
          <button class="sidebar-collapse" onClick={() => setShowPages((v) => !v)}>
            <span class="sidebar-title">Страницы ({props.pages.length})</span>
            <span class="caret">{showPages() ? "▾" : "▸"}</span>
          </button>
          <Show when={showPages()}>
            <div class="scroll-list">
              <For each={props.pages.slice(0, 300)}>
                {(name) => (
                  <button class="page-item" onClick={() => props.onOpenPage(name)}>
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </nav>
        <nav class="sidebar-section">
          <div class="sidebar-title">Журналы ({props.journals.length})</div>
          <div class="scroll-list">
            <For each={props.journals.slice(0, 40)}>
              {(name) => (
                <button class="journal-item" onClick={() => props.onOpenPage(name)}>
                  {name}
                </button>
              )}
            </For>
          </div>
        </nav>
      </Show>
    </aside>
  );
}
