import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import type { GraphSummary, Settings } from "~/lib/api";
import {
  graphLoad,
  graphSummary,
  journalList,
  pageList,
  ping,
  settingsGet,
} from "~/lib/api";import { JournalTape } from "~/components/JournalTape";
import { Kanban } from "~/components/Kanban";
import { Matrix } from "~/components/Matrix";
import { PageView } from "~/components/PageView";
import { Queries } from "~/components/Queries";
import { SettingsModal } from "~/components/SettingsModal";
import { Sidebar } from "~/components/Sidebar";

const TABS = ["Канбан", "Матрица", "Запросы"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  fontScale: 1.0,
  weekStart: 1,
  kanbanLimit: 50,
  statuses: [
    { marker: "LATER", label: "Бэклог", color: "#8ba8b5", visible: true, shortcut: null },
    { marker: "TODO", label: "К выполнению", color: "#106ba3", visible: true, shortcut: null },
    { marker: "DOING", label: "В работе", color: "#d9822b", visible: true, shortcut: null },
    { marker: "REVIEW", label: "На проверке", color: "#8a6d3b", visible: true, shortcut: null },
    { marker: "DONE", label: "Выполнено", color: "#3d8a4e", visible: true, shortcut: null },
    { marker: "CANCELED", label: "Отменено", color: "#a05252", visible: true, shortcut: null },
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
      setSettings(await settingsGet());
      void listenGraphChanged();
    } catch (e) {
      setError(String(e));
    }
  });

  // применяем тему и масштаб шрифта
  createEffect(() => {
    const s = settings();
    document.body.classList.toggle("theme-light", s.theme === "light");
    document.body.classList.toggle("theme-dark", s.theme !== "light");
    document.documentElement.style.fontSize = `${s.fontScale * 14}px`;
  });

  const listenGraphChanged = async () => {
    const { listen } = await import("@tauri-apps/api/event");
    void listen("graph-changed", () => {
      setRefreshKey((k) => k + 1);
      void graphSummary().then(async (s) => {
        setSummary(s);
        const [js, ps] = await Promise.all([journalList(), pageList()]);
        setJournals(js);
        setPages(ps);
      });
    });
  };

  const openGraph = async (path: string) => {
    setError(null);
    try {
      const s = await graphLoad(path);
      setSummary(s);
      setCurrent(null);
      setTab("Канбан");
      setSettings(await settingsGet());
      const [js, ps] = await Promise.all([journalList(), pageList()]);
      setJournals(js);
      setPages(ps);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div class="app">
      <Sidebar
        summary={summary()}
        journals={journals()}
        pages={pages()}
        onOpenPage={openPage}
        onOpenSettings={() => setShowSettings(true)}
        onOpenGraph={openGraph}
      />
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
  );
};

export default App;
