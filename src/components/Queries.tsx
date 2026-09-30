import { For, Show, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { SavedQuery, TaskDto } from "~/lib/api";
import { importLogseqQueries, queriesList, tasksByFilter } from "~/lib/api";
import { TaskCard } from "./TaskCard";

export function Queries(props: {
  refreshKey: number;
  onOpenPage: (name: string) => void;
}): JSX.Element {
  const [queries, setQueries] = createSignal<SavedQuery[]>([]);
  const [results, setResults] = createSignal<Record<string, TaskDto[]>>({});
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [error, setError] = createSignal<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const qs = await queriesList();
      setQueries(qs);
      for (const q of qs) {
        const tasks = await tasksByFilter(q.filter);
        setResults((prev) => ({ ...prev, [q.title]: tasks as never }));
        setCollapsed((prev) => ({ ...prev, [q.title]: q.collapsed }));
      }
    } catch (e) {
      setError(String(e));
    }
  };

  createEffect(() => {
    void props.refreshKey;
    void load();
  });

  const doImport = async () => {
    try {
      const n = await importLogseqQueries();
      await load();
      setError(n > 0 ? `Импортировано запросов: ${n}` : "Запросы не найдены в config.edn");
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div class="queries">
      <Show when={error()}>{(e) => <div class="queries-note">{e()}</div>}</Show>
      <Show when={queries().length === 0}>
        <button class="queries-import" onClick={doImport}>
          Импортировать запросы из logseq/config.edn
        </button>
      </Show>
      <For each={queries()}>
        {(q) => (
          <section class="query">
            <button
              class="query-head"
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [q.title]: !prev[q.title] }))
              }
            >
              <span class="caret">{collapsed()[q.title] ? "▸" : "▾"}</span>
              <span class="query-title">{q.title}</span>
              <span class="query-count">{results()[q.title]?.length ?? 0}</span>
            </button>
            <Show when={!collapsed()[q.title]}>
              <div class="query-body">
                <For each={results()[q.title] ?? []}>
                  {(task) => (
                    <TaskCard task={task} onOpenPage={props.onOpenPage} />
                  )}
                </For>
                <Show when={(results()[q.title]?.length ?? 0) === 0}>
                  <div class="kanban-empty">нет задач</div>
                </Show>
              </div>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}
