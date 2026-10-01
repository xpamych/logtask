import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphSummary, RecentGraph } from "~/lib/api";
import { pickGraphDir, recentGraphs } from "~/lib/api";

export function Sidebar(props: {
  summary: GraphSummary | null;
  /** активный пункт навигации: лента журнала / все страницы / открытая страница */
  view: "journal" | "pages" | "page";
  favorites: string[];
  recentPages: string[];
  onOpenPage: (name: string) => void;
  onShowJournal: () => void;
  onShowAllPages: () => void;
  onOpenSettings: () => void;
  onOpenGraph: (path: string) => void;
}): JSX.Element {
  const [recents, setRecents] = createSignal<RecentGraph[]>([]);
  const [graphMenu, setGraphMenu] = createSignal(false);
  const [showFavorites, setShowFavorites] = createSignal(true);
  const [showRecent, setShowRecent] = createSignal(true);

  const graphName = () => {
    const root = props.summary?.root;
    if (!root) return "Граф не выбран";
    return root.split("/").filter(Boolean).pop() ?? root;
  };

  const loadRecents = async () => {
    try {
      setRecents(await recentGraphs());
    } catch {
      setRecents([]);
    }
  };
  void loadRecents();

  const toggleGraphMenu = () => {
    // при открытии обновляем список — вдруг графы добавлялись снаружи
    if (!graphMenu()) void loadRecents();
    setGraphMenu((v) => !v);
  };

  const addGraph = async () => {
    setGraphMenu(false);
    const path = await pickGraphDir();
    if (path) props.onOpenGraph(path);
  };

  const switchGraph = (path: string) => {
    setGraphMenu(false);
    if (path !== props.summary?.root) props.onOpenGraph(path);
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-graph">
        <button
          class="graph-switch"
          title={props.summary?.root ?? "граф не выбран"}
          onClick={toggleGraphMenu}
        >
          <span class="graph-switch-name">{graphName()}</span>
          <span class="caret">{graphMenu() ? "▴" : "▾"}</span>
        </button>
        <button
          class="settings-btn"
          title="Настройки"
          onClick={props.onOpenSettings}
        >
          ⚙
        </button>
      </div>

      <Show when={graphMenu()}>
        <div class="menu-backdrop" onClick={() => setGraphMenu(false)} />
        <div class="graph-menu">
          <button class="graph-menu-item graph-menu-add" onClick={addGraph}>
            ＋ Добавить граф…
          </button>
          <Show when={recents().length > 0}>
            <div class="graph-menu-sep" />
            <For each={recents()}>
              {(g) => (
                <button
                  class="graph-menu-item"
                  classList={{ current: g.path === props.summary?.root }}
                  title={g.path}
                  onClick={() => switchGraph(g.path)}
                >
                  {g.path.split("/").filter(Boolean).pop() ?? g.path}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <nav class="sidebar-section">
        <div class="sidebar-title">Навигация</div>
        <div class="nav-list">
          <button
            class="nav-item"
            classList={{ active: props.view === "journal" }}
            onClick={props.onShowJournal}
          >
            📅 Журналы
          </button>
          <button
            class="nav-item"
            classList={{ active: props.view === "pages" }}
            onClick={props.onShowAllPages}
          >
            📄 Все страницы
          </button>
        </div>
      </nav>

      <Show when={props.favorites.length > 0}>
        <nav class="sidebar-section">
          <button class="sidebar-collapse" onClick={() => setShowFavorites((v) => !v)}>
            <span class="sidebar-title">Избранное</span>
            <span class="caret">{showFavorites() ? "▾" : "▸"}</span>
          </button>
          <Show when={showFavorites()}>
            <div class="scroll-list">
              <For each={props.favorites}>
                {(name) => (
                  <button class="page-item" onClick={() => props.onOpenPage(name)}>
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </nav>
      </Show>

      <Show when={props.recentPages.length > 0}>
        <nav class="sidebar-section">
          <button class="sidebar-collapse" onClick={() => setShowRecent((v) => !v)}>
            <span class="sidebar-title">Недавнее</span>
            <span class="caret">{showRecent() ? "▾" : "▸"}</span>
          </button>
          <Show when={showRecent()}>
            <div class="scroll-list">
              <For each={props.recentPages}>
                {(name) => (
                  <button class="page-item" onClick={() => props.onOpenPage(name)}>
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </nav>
      </Show>
    </aside>
  );
}
