import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphSummary, Settings } from "~/lib/api";
import {
  graphLoad,
  graphSummary,
  pageList,
  pickGraphDir,
  ping,
  settingsGet,
  settingsSave,
} from "~/lib/api";
import { AllPages } from "~/components/AllPages";
import { JournalTape } from "~/components/JournalTape";
import { Kanban } from "~/components/Kanban";
import { Matrix } from "~/components/Matrix";
import { PageView } from "~/components/PageView";
import PanelResizer from "~/components/PanelResizer";
import { Queries } from "~/components/Queries";
import { SettingsModal } from "~/components/SettingsModal";
import { Sidebar } from "~/components/Sidebar";
import { Topbar } from "~/components/Topbar";
import Welcome from "~/components/Welcome";

const TABS = ["Канбан", "Матрица", "Запросы"] as const;
type Tab = (typeof TABS)[number];

const RECENT_PAGES_KEY = "logtask:recentPages";

const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontScale: 1.0,
  weekStart: 1,
  kanbanLimit: 50,
  sidebarWidth: 240,
  taskpanelWidth: 320,
  favorites: [],
  systemTitlebar: false,
  statuses: [
    { marker: "LATER", label: "Бэклог", color: "#888888", visible: true, shortcut: null },
    { marker: "TODO", label: "К выполнению", color: "#09bec8", visible: true, shortcut: null },
    { marker: "DOING", label: "В работе", color: "#ff9800", visible: true, shortcut: null },
    { marker: "REVIEW", label: "На проверке", color: "#9b59b6", visible: true, shortcut: null },
    { marker: "DONE", label: "Выполнено", color: "#4caf50", visible: true, shortcut: null },
    { marker: "CANCELED", label: "Отменено", color: "#f44336", visible: true, shortcut: null },
  ],
};

function loadRecentPages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

const App: Component = () => {
  const [summary, setSummary] = createSignal<GraphSummary | null>(null);
  const [pages, setPages] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [current, setCurrent] = createSignal<string | null>(null);
  const [focusUuid, setFocusUuid] = createSignal<string | null>(null);
  const [showAllPages, setShowAllPages] = createSignal(false);
  const [tab, setTab] = createSignal<Tab>("Канбан");
  const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = createSignal(false);
  const [sidebarW, setSidebarW] = createSignal(DEFAULT_SETTINGS.sidebarWidth);
  const [panelW, setPanelW] = createSignal(DEFAULT_SETTINGS.taskpanelWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [panelCollapsed, setPanelCollapsed] = createSignal(false);
  const [recentPages, setRecentPages] = createSignal<string[]>(loadRecentPages());

  const applySettings = (s: Settings) => {
    setSettings(s);
    setSidebarW(s.sidebarWidth);
    setPanelW(s.taskpanelWidth);
  };

  // сохраняем ширины панелей после отпускания ручки
  const commitWidths = () => {
    const s = { ...settings(), sidebarWidth: sidebarW(), taskpanelWidth: panelW() };
    setSettings(s);
    void settingsSave(s).catch((e) => console.error("settings save:", e));
  };

  const openPage = (name: string, uuid?: string) => {
    if (!name) return;
    setFocusUuid(uuid ?? null);
    setShowAllPages(false);
    setCurrent(name);
    // недавние страницы (свежие первыми, максимум 10)
    const list = [name, ...recentPages().filter((p) => p !== name)].slice(0, 10);
    setRecentPages(list);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(list));
  };

  const showJournal = () => {
    setCurrent(null);
    setShowAllPages(false);
  };

  const toggleFavorite = (name: string) => {
    const s = settings();
    const favorites = s.favorites.includes(name)
      ? s.favorites.filter((f) => f !== name)
      : [...s.favorites, name];
    const next = { ...s, favorites };
    setSettings(next);
    void settingsSave(next).catch((e) => console.error("settings save:", e));
  };

  // активный пункт навигации сайдбара
  const navView = (): "journal" | "pages" | "page" =>
    current() ? "page" : showAllPages() ? "pages" : "journal";

  onMount(async () => {
    try {
      await ping();
      const s = await graphLoad();
      setSummary(s);
      setPages(await pageList());
      applySettings(await settingsGet());
      void listenGraphChanged();
    } catch (e) {
      setError(String(e));
    }
  });

  // тема: system — следуем ОС и переключаемся на лету
  const systemDark =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const [osDark, setOsDark] = createSignal(systemDark?.matches ?? true);
  onMount(() => {
    if (!systemDark) return;
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    systemDark.addEventListener("change", onChange);
    onCleanup(() => systemDark.removeEventListener("change", onChange));
  });

  // применяем тему и масштаб шрифта
  createEffect(() => {
    const s = settings();
    const dark = s.theme === "system" ? osDark() : s.theme !== "light";
    document.body.classList.toggle("theme-light", !dark);
    document.body.classList.toggle("theme-dark", dark);
    document.documentElement.style.fontSize = `${s.fontScale * 14}px`;
  });

  // системная рамка окна вкл/выкл (применяется на лету)
  createEffect(() => {
    const sys = settings().systemTitlebar;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setDecorations(sys);
      } catch {
        // фронт вне Tauri — рамкой управляет браузер
      }
    })();
  });

  let unlistenGraph: (() => void) | undefined;
  onCleanup(() => unlistenGraph?.());

  const listenGraphChanged = async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenGraph = await listen("graph-changed", () => {
        setRefreshKey((k) => k + 1);
        void graphSummary()
          .then(async (s) => {
            setSummary(s);
            setPages(await pageList());
          })
          .catch((e) => console.error("graph-changed: не обновить сводку:", e));
      });
    } catch (e) {
      // фронт запущен вне Tauri (npm run dev) — live-обновления недоступны
      console.warn("слушатель graph-changed не подключён:", e);
    }
  };

  const openGraph = async (path: string) => {
    setError(null);
    try {
      const s = await graphLoad(path);
      setSummary(s);
      setCurrent(null);
      setShowAllPages(false);
      setTab("Канбан");
      applySettings(await settingsGet());
      setPages(await pageList());
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  // первый запуск: граф не выбран — показываем приветственный экран
  const graphNotChosen = () =>
    !summary() && (error() ?? "").includes("граф не выбран");

  const pickGraph = async () => {
    const path = await pickGraphDir();
    if (path) await openGraph(path);
  };

  const gridCols = () =>
    `${sidebarCollapsed() ? 0 : sidebarW()}px ${sidebarCollapsed() ? 0 : 5}px 1fr ` +
    `${panelCollapsed() ? 0 : 5}px ${panelCollapsed() ? 0 : panelW()}px`;

  return (
    <Show when={!graphNotChosen()} fallback={<Welcome onPick={pickGraph} />}>
      <div class="shell">
        <Topbar
          onOpenPage={openPage}
          sidebarCollapsed={sidebarCollapsed()}
          panelCollapsed={panelCollapsed()}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onTogglePanel={() => setPanelCollapsed((v) => !v)}
          systemTitlebar={settings().systemTitlebar}
        />
        <div class="app" style={{ "grid-template-columns": gridCols() }}>
          <Show when={!sidebarCollapsed()}>
            <Sidebar
              summary={summary()}
              view={navView()}
              favorites={settings().favorites}
              recentPages={recentPages()}
              onOpenPage={openPage}
              onShowJournal={showJournal}
              onShowAllPages={() => {
                setCurrent(null);
                setShowAllPages(true);
              }}
              onOpenSettings={() => setShowSettings(true)}
              onOpenGraph={openGraph}
            />
            <PanelResizer side="left" start={sidebarW} onResize={setSidebarW} onCommit={commitWidths} />
          </Show>
          <Show
            when={current()}
            fallback={
              <Show
                when={showAllPages()}
                fallback={<JournalTape refreshKey={refreshKey()} onOpenPage={openPage} settings={settings()} />}
              >
                <AllPages
                  pages={pages()}
                  favorites={settings().favorites}
                  onOpenPage={openPage}
                  onToggleFavorite={toggleFavorite}
                />
              </Show>
            }
          >
            {(name) => (
              <PageView
                name={name()}
                onOpenPage={openPage}
                refreshKey={refreshKey()}
                focusUuid={focusUuid()}
                settings={settings()}
                favorite={settings().favorites.includes(name())}
                onToggleFavorite={() => toggleFavorite(name())}
              />
            )}
          </Show>
          <Show when={!panelCollapsed()}>
            <PanelResizer side="right" start={panelW} onResize={setPanelW} onCommit={commitWidths} />
            <aside class="taskpanel">
              <div class="tabs">
                <For each={TABS}>
                  {(t) => (
                    <button
                      class="tab"
                      classList={{ active: tab() === t }}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  )}
                </For>
              </div>
              <div class="taskpanel-body">
                <Show when={current()}>
                  <button class="back-to-journal" onClick={showJournal}>
                    ← К ленте журнала
                  </button>
                </Show>
                <Show
                  when={tab() === "Канбан"}
                  fallback={
                    <Show
                      when={tab() === "Запросы"}
                      fallback={<Matrix refreshKey={refreshKey()} onOpenPage={openPage} />}
                    >
                      <Queries refreshKey={refreshKey()} onOpenPage={openPage} />
                    </Show>
                  }
                >
                  <Kanban
                    refreshKey={refreshKey()}
                    onOpenPage={openPage}
                    settings={settings()}
                  />
                </Show>
                <Show when={error()}>{(e) => <p class="error">{e()}</p>}</Show>
              </div>
            </aside>
          </Show>
          <Show when={showSettings()}>
            <SettingsModal
              settings={settings()}
              onClose={() => setShowSettings(false)}
              onSaved={setSettings}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default App;
