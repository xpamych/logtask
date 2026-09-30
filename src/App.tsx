import type { Component } from "solid-js";
import { For, Show, createSignal, onMount } from "solid-js";
import type { GraphSummary } from "~/lib/api";
import { graphLoad, graphSummary, journalList, pageList, ping } from "~/lib/api";
import { JournalTape } from "~/components/JournalTape";
import { Kanban } from "~/components/Kanban";
import { PageView } from "~/components/PageView";
import { Queries } from "~/components/Queries";
import { Sidebar } from "~/components/Sidebar";

const TABS = ["Канбан", "Матрица", "Запросы"] as const;
type Tab = (typeof TABS)[number];

const App: Component = () => {
  const [summary, setSummary] = createSignal<GraphSummary | null>(null);
  const [journals, setJournals] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [current, setCurrent] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<Tab>("Канбан");

  const openPage = (name: string) => {
    if (!name) return;
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
      void listenGraphChanged();
    } catch (e) {
      setError(String(e));
    }
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

  return (
    <div class="app">
      <Sidebar
        summary={summary()}
        journals={journals()}
        pages={pages()}
        onOpenPage={openPage}
      />
      <Show
        when={current()}
        fallback={<JournalTape refreshKey={refreshKey()} onOpenPage={openPage} />}
      >
        {(name) => (
          <PageView name={name()} onOpenPage={openPage} refreshKey={refreshKey()} />
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
                fallback={<p class="muted">Матрица Эйзенхауэра — Фаза 4.</p>}
              >
                <Queries refreshKey={refreshKey()} onOpenPage={openPage} />
              </Show>
            }
          >
            <Kanban refreshKey={refreshKey()} onOpenPage={openPage} />
          </Show>
          <Show when={error()}>{(e) => <p class="error">{e()}</p>}</Show>
        </div>
      </aside>
    </div>
  );
};

export default App;
