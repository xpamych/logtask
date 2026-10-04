import { For, Show, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { SavedQuery, Settings, TaskDto, TaskFilter } from "~/lib/api";
import {
  importLogseqQueries,
  queriesList,
  queriesSave,
  tasksByFilter,
} from "~/lib/api";
import { QueryEditor } from "./QueryEditor";
import { TaskCard } from "./TaskCard";

const EMPTY_FILTER: TaskFilter = {
  open: false,
  status: [],
  page: null,
  pagePrefix: null,
  excludePage: null,
  tags: [],
  quadrant: null,
};

/** Шаблоны для пустого состояния: типовые подборки одним кликом */
const TEMPLATES: { title: string; hint: string; filter: TaskFilter }[] = [
  {
    title: "Сейчас в работе",
    hint: "статусы «В работе» и «На проверке»",
    filter: { ...EMPTY_FILTER, open: true, status: ["DOING", "REVIEW"] },
  },
  {
    title: "Бэклог",
    hint: "отложенные задачи со статусом «Бэклог»",
    filter: { ...EMPTY_FILTER, open: true, status: ["LATER"] },
  },
  {
    title: "Всё открытое",
    hint: "все незавершённые задачи графа",
    filter: { ...EMPTY_FILTER, open: true },
  },
];

const QUADRANT_LABELS: Record<string, string> = {
  do: "Сделать",
  schedule: "Запланировать",
  delegate: "Делегировать",
  drop: "Отбросить",
};

/** Склонение: 1 задача / 2 задачи / 5 задач */
function pluralTasks(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} задач`;
  if (mod10 === 1) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} задачи`;
  return `${n} задач`;
}

/** Человекочитаемое описание фильтра: «открытые · В работе · #проект» */
export function filterSummary(q: SavedQuery, settings?: Settings | null): string {
  const parts: string[] = [q.filter.open ? "открытые" : "все статусы"];
  const labelOf = (marker: string) =>
    settings?.statuses.find((s) => s.marker === marker)?.label ?? marker;
  if (q.filter.status.length > 0) {
    parts.push(q.filter.status.map(labelOf).join(", "));
  }
  if (q.filter.page) parts.push(`страница «${q.filter.page}»`);
  if (q.filter.pagePrefix) parts.push(`страница начинается с «${q.filter.pagePrefix}»`);
  if (q.filter.excludePage) parts.push(`кроме «${q.filter.excludePage}»`);
  if (q.filter.tags.length > 0) {
    parts.push(q.filter.tags.map((t) => `#${t}`).join(" "));
  }
  if (q.filter.quadrant) {
    parts.push(`квадрант «${QUADRANT_LABELS[q.filter.quadrant] ?? q.filter.quadrant}»`);
  }
  return parts.join(" · ");
}

export function Queries(props: {
  refreshKey: number;
  settings?: Settings | null;
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
        setResults((prev) => ({ ...prev, [q.title]: tasks }));
        // не перезаписываем ручную свёртку при перезагрузке по graph-changed
        setCollapsed((prev) =>
          q.title in prev ? prev : { ...prev, [q.title]: q.collapsed },
        );
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
      setError(n > 0 ? `Импортировано подборок: ${n}` : "Подборки не найдены в config.edn");
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

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    void persist([
      ...queries(),
      { title: t.title, filter: { ...t.filter }, sort: [], collapsed: false },
    ]);
  };

  return (
    <div class="queries">
      <div class="queries-toolbar">
        <button class="queries-import" onClick={newQuery}>
          ＋ Новая подборка
        </button>
        <button
          class="queries-import"
          onClick={doImport}
          title="Импорт :default-queries из logseq/config.edn"
        >
          ⤓ Импорт из Logseq
        </button>
      </div>
      <Show when={error()}>{(e) => <div class="queries-note">{e()}</div>}</Show>

      <Show when={queries().length === 0}>
        <div class="queries-empty">
          <p class="queries-empty-text">
            Подборка — это сохранённый фильтр: она всегда показывает актуальный
            список задач по заданным условиям (статусы, страница, теги).
            Начните с шаблона или создайте свою:
          </p>
          <div class="queries-templates">
            <For each={TEMPLATES}>
              {(t) => (
                <button class="queries-template" onClick={() => applyTemplate(t)}>
                  <span class="queries-template-title">{t.title}</span>
                  <span class="queries-template-hint">{t.hint}</span>
                </button>
              )}
            </For>
          </div>
        </div>
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
              <span class="query-summary">{filterSummary(q, props.settings)}</span>
              <span class="query-count">
                {pluralTasks(results()[q.title]?.length ?? 0)}
              </span>
              <span
                class="query-edit"
                title="Настроить подборку"
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
                    <TaskCard
                      task={task}
                      detailed
                      settings={props.settings}
                      onChanged={() => void load()}
                      onOpenPage={props.onOpenPage}
                    />
                  )}
                </For>
                <Show when={(results()[q.title]?.length ?? 0) === 0}>
                  <div class="kanban-empty">нет задач по этим условиям</div>
                </Show>
              </div>
            </Show>
          </section>
        )}
      </For>
      <Show when={editorOpen()}>
        <QueryEditor
          query={editing()}
          settings={props.settings}
          onClose={() => setEditorOpen(false)}
          onSave={onSaveQuery}
          onDelete={onDeleteQuery}
        />
      </Show>
    </div>
  );
}
