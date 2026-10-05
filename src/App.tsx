import type { Component } from "solid-js";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphSummary, Settings } from "~/lib/api";
import {
  graphClose,
  graphCreate,
  graphLoad,
  graphNeedsScaffold,
  graphSummary,
  pageList,
  pickGraphDir,
  ping,
  settingsGet,
  settingsSave,
} from "~/lib/api";
import { AllPages } from "~/components/AllPages";
import { Contents } from "~/components/Contents";
import { JournalTape } from "~/components/JournalTape";
import { PageView } from "~/components/PageView";
import PanelResizer from "~/components/PanelResizer";
import { SettingsModal } from "~/components/SettingsModal";
import { Sidebar } from "~/components/Sidebar";
import { TasksPage } from "~/components/TasksPage";
import { Topbar } from "~/components/Topbar";
import Welcome from "~/components/Welcome";

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
  homeView: "journal",
  statuses: [
    { marker: "LATER", label: "Бэклог", color: "#888888", visible: true, shortcut: null },
    { marker: "TODO", label: "К выполнению", color: "#09bec8", visible: true, shortcut: null },
    { marker: "DOING", label: "В работе", color: "#ff9800", visible: true, shortcut: null },
    { marker: "REVIEW", label: "На проверке", color: "#9b59b6", visible: true, shortcut: null },
    { marker: "DONE", label: "Выполнено", color: "#4caf50", visible: true, shortcut: null },
    { marker: "CANCELED", label: "Отменено", color: "#f44336", visible: true, shortcut: null },
  ],
  integrations: { sources: [] },
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
  const [showTasks, setShowTasks] = createSignal(false);
  const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = createSignal(false);
  const [sidebarW, setSidebarW] = createSignal(DEFAULT_SETTINGS.sidebarWidth);
  const [panelW, setPanelW] = createSignal(DEFAULT_SETTINGS.taskpanelWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [panelCollapsed, setPanelCollapsed] = createSignal(false);
  const [recentPages, setRecentPages] = createSignal<string[]>(loadRecentPages());
  // граф явно закрыт пользователем — показываем экран приветствия
  const [graphClosed, setGraphClosed] = createSignal(false);

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

  // история навигации для кнопок назад/вперёд/домой
  type View =
    | { kind: "journal" }
    | { kind: "tasks" }
    | { kind: "pages" }
    | { kind: "page"; name: string };

  const currentView = (): View =>
    current()
      ? { kind: "page", name: current()! }
      : showTasks()
        ? { kind: "tasks" }
        : showAllPages()
          ? { kind: "pages" }
          : { kind: "journal" };

  const [backStack, setBackStack] = createSignal<View[]>([]);
  const [fwdStack, setFwdStack] = createSignal<View[]>([]);

  const applyView = (v: View) => {
    setFocusUuid(null);
    setCurrent(v.kind === "page" ? v.name : null);
    setShowTasks(v.kind === "tasks");
    setShowAllPages(v.kind === "pages");
  };

  const navigate = (v: View) => {
    const cur = currentView();
    if (JSON.stringify(cur) !== JSON.stringify(v)) {
      setBackStack((s) => [...s.slice(-49), cur]);
      setFwdStack([]);
    }
    applyView(v);
  };

  const goBack = () => {
    const stack = backStack();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setBackStack(stack.slice(0, -1));
    setFwdStack((s) => [...s, currentView()]);
    applyView(prev);
  };

  const goForward = () => {
    const stack = fwdStack();
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setFwdStack(stack.slice(0, -1));
    setBackStack((s) => [...s, currentView()]);
    applyView(next);
  };

  // боковые кнопки мыши: «назад» (3) / «вперёд» (4) — навигация по истории видов
  onMount(() => {
    const onMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    window.addEventListener("mousedown", onMouseNav);
    onCleanup(() => window.removeEventListener("mousedown", onMouseNav));
  });

  const openPage = (name: string, uuid?: string) => {
    if (!name) return;
    navigate({ kind: "page", name });
    setFocusUuid(uuid ?? null);
    // недавние страницы (свежие первыми, максимум 10)
    const list = [name, ...recentPages().filter((p) => p !== name)].slice(0, 10);
    setRecentPages(list);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(list));
  };

  const showJournal = () => navigate({ kind: "journal" });

  const showTasksPage = () => navigate({ kind: "tasks" });

  const showAllPagesView = () => navigate({ kind: "pages" });

  // домашний вид из настроек: кнопка «⌂» и стартовый экран графа
  const homeViewOf = (s: Settings): View =>
    s.homeView === "tasks"
      ? { kind: "tasks" }
      : s.homeView === "pages"
        ? { kind: "pages" }
        : { kind: "journal" };

  const showHome = () => navigate(homeViewOf(settings()));

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
  const navView = (): "journal" | "pages" | "page" | "tasks" =>
    current() ? "page" : showTasks() ? "tasks" : showAllPages() ? "pages" : "journal";

  onMount(async () => {
    try {
      await ping();
      const s = await graphLoad();
      setSummary(s);
      setPages(await pageList());
      const st = await settingsGet();
      applySettings(st);
      // стартовый вид — домашняя страница из настроек
      applyView(homeViewOf(st));
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
      // папка без journals/ и pages/ — предлагаем создать граф с нуля
      if (await graphNeedsScaffold(path)) {
        const ok = confirm(
          `В папке «${path}» нет journals/ и pages/.\nСоздать здесь новый граф?`,
        );
        if (!ok) return;
        await graphCreate(path);
      }
      const s = await graphLoad(path);
      setSummary(s);
      setGraphClosed(false);
      setBackStack([]);
      setFwdStack([]);
      const st = await settingsGet();
      applySettings(st);
      // стартовый вид графа — домашняя страница из настроек
      applyView(homeViewOf(st));
      setPages(await pageList());
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  // закрыть текущий граф: выгружаем в Rust и возвращаемся на экран приветствия
  const closeGraph = async () => {
    try {
      await graphClose();
    } catch (e) {
      console.error("graph close:", e);
    }
    setSummary(null);
    setPages([]);
    setCurrent(null);
    setShowAllPages(false);
    setShowTasks(false);
    setBackStack([]);
    setFwdStack([]);
    setError(null);
    setGraphClosed(true);
  };

  // первый запуск: граф не выбран — показываем приветственный экран
  const graphNotChosen = () =>
    !summary() && (graphClosed() || (error() ?? "").includes("граф не выбран"));

  const pickGraph = async () => {
    const path = await pickGraphDir();
    if (path) await openGraph(path);
  };

  // новый граф с нуля: выбор папки → scaffold (journals/ + pages/) → открытие
  const createGraph = async () => {
    const path = await pickGraphDir("Выбрать папку для нового графа");
    if (!path) return;
    setError(null);
    try {
      await graphCreate(path);
    } catch (e) {
      setError(String(e));
      return;
    }
    await openGraph(path);
  };

  const gridCols = () =>
    `${sidebarCollapsed() ? 0 : sidebarW()}px ${sidebarCollapsed() ? 0 : 5}px 1fr ` +
    `${panelCollapsed() ? 0 : 5}px ${panelCollapsed() ? 0 : panelW()}px`;

  return (
    <Show when={!graphNotChosen()} fallback={<Welcome onPick={pickGraph} onCreate={createGraph} />}>
      <div class="shell">
        <Topbar
          onOpenPage={openPage}
          sidebarCollapsed={sidebarCollapsed()}
          panelCollapsed={panelCollapsed()}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          onTogglePanel={() => setPanelCollapsed((v) => !v)}
          systemTitlebar={settings().systemTitlebar}
          canBack={backStack().length > 0}
          canForward={fwdStack().length > 0}
          onBack={goBack}
          onForward={goForward}
          onHome={showHome}
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
              onShowTasks={showTasksPage}
              onShowAllPages={showAllPagesView}
              onOpenSettings={() => setShowSettings(true)}
              onOpenGraph={openGraph}
              onCloseGraph={() => void closeGraph()}
            />
            <PanelResizer side="left" start={sidebarW} onResize={setSidebarW} onCommit={commitWidths} />
          </Show>
          <Show when={summary()}>
            <Show
              when={current()}
              fallback={
                <Show
                  when={showTasks()}
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
                  <TasksPage
                    refreshKey={refreshKey()}
                    settings={settings()}
                    onOpenPage={openPage}
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
          </Show>
          <Show when={!panelCollapsed()}>
            <PanelResizer side="right" start={panelW} onResize={setPanelW} onCommit={commitWidths} />
            <aside class="taskpanel">
              <div class="tabs">
                <button class="tab active">Оглавление</button>
              </div>
              <div class="taskpanel-body">
                <Contents
                  page={current()}
                  refreshKey={refreshKey()}
                  onOpenPage={openPage}
                />
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
