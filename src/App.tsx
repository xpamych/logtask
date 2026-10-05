import type { Component } from "solid-js";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphSummary, Settings } from "~/lib/api";
import {
  graphClose,
  graphCreate,
  graphLoad,
  graphNeedsScaffold,
  graphSummary,
  integrationsSync,
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
import { SettingsPage } from "~/components/SettingsPage";
import type { SettingsSection } from "~/components/SettingsPage";
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
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection | null>(null);
  const [sidebarW, setSidebarW] = createSignal(DEFAULT_SETTINGS.sidebarWidth);
  const [panelW, setPanelW] = createSignal(DEFAULT_SETTINGS.taskpanelWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [panelCollapsed, setPanelCollapsed] = createSignal(false);
  const [recentPages, setRecentPages] = createSignal<string[]>(loadRecentPages());
  // граф явно закрыт пользователем — показываем экран приветствия
  const [graphClosed, setGraphClosed] = createSignal(false);

  const [syncing, setSyncing] = createSignal(false);
  const [syncConflicts, setSyncConflicts] = createSignal(0);
  const [toast, setToast] = createSignal<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // автосохранение настроек: точка-индикатор в сайдбаре
  const [saveState, setSaveState] = createSignal<"saved" | "dirty" | "error">("saved");
  const [saveError, setSaveError] = createSignal<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // изменения со страницы настроек: мгновенно в сигнал (тема/шрифт
  // применяются сразу), на диск — сразу или с дебаунсом 400 мс
  const saveSettingsAuto = (s: Settings, opts?: { immediate?: boolean }) => {
    setSettings(s);
    setSaveState("dirty");
    setSaveError(null);
    clearTimeout(saveTimer);
    const run = () => {
      void settingsSave(s)
        .then(() => setSaveState("saved"))
        .catch((e) => {
          setSaveState("error");
          setSaveError(String(e));
        });
    };
    if (opts?.immediate) run();
    else saveTimer = setTimeout(run, 400);
  };

  const showToast = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 6000);
  };

  const runSync = async () => {
    setSyncing(true);
    manualSync = true;
    try {
      const reports = await integrationsSync();
      const conflicts = reports.reduce((n, r) => n + r.conflicts, 0);
      setSyncConflicts(conflicts);
      const errors = reports.filter((r) => r.error);
      if (reports.length === 0) {
        showToast("Интеграции не настроены — добавьте источник в настройках");
      } else if (errors.length > 0) {
        showToast(`Синхронизация: ошибки в ${errors.map((r) => r.source).join(", ")}`);
      } else {
        const added = reports.reduce((n, r) => n + r.added, 0);
        const updated = reports.reduce((n, r) => n + r.updated, 0);
        showToast(
          `Синхронизировано: новых ${added}, обновлено ${updated}` +
            (conflicts > 0 ? `, конфликтов ${conflicts}` : ""),
        );
      }
    } catch (e) {
      showToast(`Синхронизация не удалась: ${e}`);
    } finally {
      manualSync = false;
      setSyncing(false);
    }
  };

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
    | { kind: "settings"; section: SettingsSection }
    | { kind: "page"; name: string };

  const currentView = (): View =>
    settingsSection()
      ? { kind: "settings", section: settingsSection()! }
      : current()
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
    setSettingsSection(v.kind === "settings" ? v.section : null);
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

  const showSettingsView = (section: SettingsSection) =>
    navigate({ kind: "settings", section });

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

  // страница переименована: подменяем имя в избранном и недавних,
  // навигируем на новое имя (индекс уже обновлён — придёт graph-changed)
  const renameCurrentPage = (newName: string) => {
    const old = current();
    if (!old) return;
    const s = settings();
    if (s.favorites.includes(old)) {
      const favorites = s.favorites.map((f) => (f === old ? newName : f));
      const next = { ...s, favorites };
      setSettings(next);
      void settingsSave(next).catch((e) => console.error("settings save:", e));
    }
    if (recentPages().includes(old)) {
      const rec = recentPages().map((r) => (r === old ? newName : r));
      setRecentPages(rec);
      localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(rec));
    }
    openPage(newName);
  };

  // активный пункт навигации сайдбара
  const navView = (): "journal" | "pages" | "page" | "tasks" | "settings" =>
    settingsSection()
      ? "settings"
      : current()
        ? "page"
        : showTasks()
          ? "tasks"
          : showAllPages()
            ? "pages"
            : "journal";

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
      void listenSyncEvents();
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
  const unlistenSync: (() => void)[] = [];
  onCleanup(() => {
    unlistenGraph?.();
    unlistenSync.forEach((u) => u());
  });

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

  // фоновые синки интеграций (по интервалу/при открытии графа) — прогресс и ошибки
  // ручной синк (кнопка ⟳) сам показывает итог — его события не дублируем
  let manualSync = false;
  const listenSyncEvents = async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenSync.push(await listen("sync-started", () => setSyncing(true)));
      unlistenSync.push(
        await listen<{ source: string; conflicts: number; error?: string }>(
          "sync-finished",
          (e) => {
            setSyncing(false);
            if (!manualSync && e.payload.error) {
              showToast(`Синхронизация «${e.payload.source}»: ${e.payload.error}`);
            }
            if (!manualSync && e.payload.conflicts > 0) {
              setSyncConflicts((n) => n + e.payload.conflicts);
            }
          },
        ),
      );
    } catch {
      /* вне Tauri */
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
          onSync={() => void runSync()}
          syncing={syncing()}
          syncConflicts={syncConflicts()}
        />
        <div class="app" style={{ "grid-template-columns": gridCols() }}>
          <Show when={!sidebarCollapsed()}>
            <Sidebar
              summary={summary()}
              view={navView()}
              settingsSection={settingsSection()}
              saveState={saveState()}
              saveError={saveError()}
              favorites={settings().favorites}
              recentPages={recentPages()}
              onOpenPage={openPage}
              onShowJournal={showJournal}
              onShowTasks={showTasksPage}
              onShowAllPages={showAllPagesView}
              onOpenSettings={showSettingsView}
              onOpenGraph={openGraph}
              onCloseGraph={() => void closeGraph()}
            />
            <PanelResizer side="left" start={sidebarW} onResize={setSidebarW} onCommit={commitWidths} />
          </Show>
          <Show when={summary()}>
            <Show
              when={settingsSection()}
              fallback={
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
                      onRename={renameCurrentPage}
                    />
                  )}
                </Show>
              }
            >
              {(sec) => (
                <SettingsPage
                  settings={settings()}
                  section={sec()}
                  saveError={saveError()}
                  onChange={saveSettingsAuto}
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
        </div>
        <Show when={toast()}>
          <div class="toast">{toast()}</div>
        </Show>
      </div>
    </Show>
  );
};

export default App;
