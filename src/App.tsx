import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphSummary, Settings } from "~/lib/api";
import {
  graphLoad,
  graphSummary,
  journalList,
  pageList,
  pickGraphDir,
  ping,
  settingsGet,
  settingsSave,
} from "~/lib/api";
import { JournalTape } from "~/components/JournalTape";
import { Kanban } from "~/components/Kanban";
import { Matrix } from "~/components/Matrix";
import { PageView } from "~/components/PageView";
import PanelResizer from "~/components/PanelResizer";
import { Queries } from "~/components/Queries";
import { SettingsModal } from "~/components/SettingsModal";
import { Sidebar } from "~/components/Sidebar";
import Welcome from "~/components/Welcome";

const TABS = ["Канбан", "Матрица", "Запросы"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontScale: 1.0,
  weekStart: 1,
  kanbanLimit: 50,
  sidebarWidth: 240,
  taskpanelWidth: 320,
  statuses: [
    { marker: "LATER", label: "Бэклог", color: "#888888", visible: true, shortcut: null },
    { marker: "TODO", label: "К выполнению", color: "#09bec8", visible: true, shortcut: null },
    { marker: "DOING", label: "В работе", color: "#ff9800", visible: true, shortcut: null },
    { marker: "REVIEW", label: "На проверке", color: "#9b59b6", visible: true, shortcut: null },
    { marker: "DONE", label: "Выполнено", color: "#4caf50", visible: true, shortcut: null },
    { marker: "CANCELED", label: "Отменено", color: "#f44336", visible: true, shortcut: null },
  ],
};

const App: Component = () => {
  const [summary, setSummary] = createSignal<GraphSummary | null>(null);
  const [journals, setJournals] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [current, setCurrent] = createSignal<string | null>(null);
  const [focusUuid, setFocusUuid] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<Tab>("Канбан");
  const [settings, setSettings] = createSignal<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = createSignal(false);
  const [sidebarW, setSidebarW] = createSignal(DEFAULT_SETTINGS.sidebarWidth);
  const [panelW, setPanelW] = createSignal(DEFAULT_SETTINGS.taskpanelWidth);

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
    setCurrent(name);
  };

  const backToJournal = () => setCurrent(null);

  onMount(async () => {
    try {
      await ping();
      const s = await graphLoad();
      setSummary(s);
      const [js, ps] = await Promise.all([journalList(), pageList()]);
      setJournals(js);
      setPages(ps);
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
            const [js, ps] = await Promise.all([journalList(), pageList()]);
            setJournals(js);
            setPages(ps);
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
      setTab("Канбан");
      applySettings(await settingsGet());
      const [js, ps] = await Promise.all([journalList(), pageList()]);
      setJournals(js);
      setPages(ps);
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

  return (
    <Show when={!graphNotChosen()} fallback={<Welcome onPick={pickGraph} />}>
    <div
      class="app"
      style={{ "grid-template-columns": `${sidebarW()}px 5px 1fr 5px ${panelW()}px` }}
    >
      <Sidebar
        summary={summary()}
        journals={journals()}
        pages={pages()}
        onOpenPage={openPage}
        onOpenSettings={() => setShowSettings(true)}
        onOpenGraph={openGraph}
      />
      <PanelResizer side="left" start={sidebarW} onResize={setSidebarW} onCommit={commitWidths} />
      <Show
        when={current()}
        fallback={<JournalTape refreshKey={refreshKey()} onOpenPage={openPage} settings={settings()} />}
      >
        {(name) => (
          <PageView
            name={name()}
            onOpenPage={openPage}
            refreshKey={refreshKey()}
            focusUuid={focusUuid()}
            settings={settings()}
          />
        )}
      </Show>
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
            <button class="back-to-journal" onClick={backToJournal}>
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
      <Show when={showSettings()}>
        <SettingsModal
          settings={settings()}
          onClose={() => setShowSettings(false)}
          onSaved={setSettings}
        />
      </Show>
    </div>
    </Show>
  );
};

export default App;
