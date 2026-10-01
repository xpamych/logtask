import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphSummary, RecentGraph } from "~/lib/api";
import { pickGraphDir, recentGraphs } from "~/lib/api";

export function Sidebar(props: {
  summary: GraphSummary | null;
  journals: string[];
  pages: string[];
  onOpenPage: (name: string) => void;
  onOpenSettings: () => void;
  onOpenGraph: (path: string) => void;
}): JSX.Element {
  const [showPages, setShowPages] = createSignal(true);
  const [recents, setRecents] = createSignal<RecentGraph[]>([]);
  const [graphMenu, setGraphMenu] = createSignal(false);

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
    </aside>
  );
}
