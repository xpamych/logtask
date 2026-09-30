import type { Component } from "solid-js";
import { Show, createSignal, onMount } from "solid-js";
import type { GraphSummary } from "~/lib/api";
import { graphLoad, graphSummary, journalList, pageList, ping } from "~/lib/api";
import { JournalTape } from "~/components/JournalTape";
import { PageView } from "~/components/PageView";
import { Sidebar } from "~/components/Sidebar";

const App: Component = () => {
  const [summary, setSummary] = createSignal<GraphSummary | null>(null);
  const [journals, setJournals] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [current, setCurrent] = createSignal<string | null>(null);

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
          <button class="tab active">Канбан</button>
          <button class="tab">Матрица</button>
          <button class="tab">Запросы</button>
        </div>
        <div class="taskpanel-body">
          <Show when={current()}>
            <button class="back-to-journal" onClick={backToJournal}>
              ← К ленте журнала
            </button>
          </Show>
          <p class="muted">Панель задач — Фазы 3–4.</p>
          <Show when={error()}>
            {(e) => <p class="error">{e()}</p>}
          </Show>
        </div>
      </aside>
    </div>
  );
};

export default App;
