import { For, Show, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { SavedQuery, TaskDto } from "~/lib/api";
import {
  importLogseqQueries,
  queriesList,
  queriesSave,
  tasksByFilter,
} from "~/lib/api";
import { QueryEditor } from "./QueryEditor";
import { TaskCard } from "./TaskCard";

export function Queries(props: {
  refreshKey: number;
  onOpenPage: (name: string) => void;
}): JSX.Element {
  const [queries, setQueries] = createSignal<SavedQuery[]>([]);
  const [results, setResults] = createSignal<Record<string, TaskDto[]>>({});
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<SavedQuery | null>(null);
  const [editorOpen, setEditorOpen] = createSignal(false);

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

  const persist = async (qs: SavedQuery[]) => {
    try {
      await queriesSave(qs);
      setQueries(qs);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const onSaveQuery = (q: SavedQuery) => {
    const qs = queries();
    const idx = qs.findIndex((x) => x.title === q.title);
    const updated =
      idx === -1
        ? [...qs, q]
        : qs.map((x, i) => (i === idx ? q : x));
    void persist(updated);
  };

  const onDeleteQuery = (title: string) => {
    void persist(queries().filter((q) => q.title !== title));
  };

  const newQuery = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const editQuery = (q: SavedQuery) => {
    setEditing(q);
    setEditorOpen(true);
  };

  return (
    <div class="queries">
      <div class="queries-toolbar">
        <button class="queries-import" onClick={newQuery}>
          ＋ новый запрос
        </button>
        <button class="queries-import" onClick={doImport} title="Импорт из logseq/config.edn">
          ⤓ импорт из config.edn
        </button>
      </div>
      <Show when={error()}>{(e) => <div class="queries-note">{e()}</div>}</Show>
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
              <span
                class="query-edit"
                title="Редактировать запрос"
                onClick={(e) => {
                  e.stopPropagation();
                  editQuery(q);
                }}
              >
                ✎
              </span>
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
      <Show when={editorOpen()}>
        <QueryEditor
          query={editing()}
          onClose={() => setEditorOpen(false)}
          onSave={onSaveQuery}
          onDelete={onDeleteQuery}
        />
      </Show>
    </div>
  );
}
