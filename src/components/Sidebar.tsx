import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphSummary, RecentGraph } from "~/lib/api";
import { pickGraphDir, recentGraphs, recentRemove } from "~/lib/api";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import type { SettingsSection } from "./SettingsPage";

export function Sidebar(props: {
  summary: GraphSummary | null;
  /** активный пункт навигации: лента журнала / задачи / все страницы / открытая страница / настройки */
  view: "journal" | "pages" | "page" | "tasks" | "settings";
  /** активный раздел настроек (null — настройки закрыты) */
  settingsSection: SettingsSection | null;
  /** состояние автосохранения настроек: точка у пункта «Настройки» */
  saveState: "saved" | "dirty" | "error";
  saveError: string | null;
  favorites: string[];
  recentPages: string[];
  onOpenPage: (name: string) => void;
  onShowJournal: () => void;
  onShowTasks: () => void;
  onShowAllPages: () => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenGraph: (path: string) => void;
  onCloseGraph: () => void;
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

  const removeGraph = async (path: string) => {
    await recentRemove(path);
    setRecents((list) => list.filter((g) => g.path !== path));
    // удалили текущий граф — закрываем его и уходим на экран приветствия
    if (path === props.summary?.root) props.onCloseGraph();
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
                <div
                  class="graph-menu-row"
                  classList={{ current: g.path === props.summary?.root }}
                >
                  <button
                    class="graph-menu-item"
                    title={g.path}
                    onClick={() => switchGraph(g.path)}
                  >
                    {g.path.split("/").filter(Boolean).pop() ?? g.path}
                  </button>
                  <button
                    class="graph-menu-remove"
                    title={`Убрать из списка: ${g.path}`}
                    onClick={() => void removeGraph(g.path)}
                  >
                    ✕
                  </button>
                </div>
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
            classList={{ active: props.view === "tasks" }}
            onClick={props.onShowTasks}
          >
            ✓ Задачи
          </button>
          <button
            class="nav-item"
            classList={{ active: props.view === "pages" }}
            onClick={props.onShowAllPages}
          >
            📄 Все страницы
          </button>
          <button
            class="nav-item nav-settings"
            classList={{ active: props.view === "settings" }}
            onClick={() => props.onOpenSettings("general")}
          >
            ⚙ Настройки
            <span
              class="save-dot"
              classList={{
                saved: props.saveState === "saved",
                dirty: props.saveState === "dirty",
                error: props.saveState === "error",
              }}
              title={
                props.saveState === "error"
                  ? `Ошибка сохранения: ${props.saveError ?? ""}`
                  : props.saveState === "dirty"
                    ? "Сохранение…"
                    : "Настройки сохранены"
              }
            />
          </button>
          <Show when={props.view === "settings" && props.settingsSection}>
            {(sec) => (
              <div class="nav-sublist">
                <For each={SETTINGS_SECTIONS}>
                  {(s) => (
                    <button
                      class="nav-item nav-subitem"
                      classList={{ active: sec() === s.id }}
                      onClick={() => props.onOpenSettings(s.id)}
                    >
                      {s.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
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
