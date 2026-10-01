import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings, TaskColumn } from "~/lib/api";
import { kanban, taskSetStatus } from "~/lib/api";
import { TaskCard } from "./TaskCard";

const CLOSED_MARKERS = ["DONE", "CANCELED"];

interface KanbanFilter {
  search: string;
  page: string;
  hideClosed: boolean;
}

const STORAGE_KEY = "logtask.kanban.filter";

function loadFilter(): KanbanFilter {
  const empty: KanbanFilter = { search: "", page: "", hideClosed: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...empty, ...JSON.parse(raw) };
  } catch {
    // localStorage недоступен — дефолт
  }
  return empty;
}

export function Kanban(props: {
  refreshKey: number;
  onOpenPage: (name: string, uuid?: string) => void;
  settings?: Settings | null;
}): JSX.Element {
  const [columns, setColumns] = createSignal<TaskColumn[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [dragOver, setDragOver] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [filter, setFilter] = createSignal<KanbanFilter>(loadFilter());

  const colorOf = (marker: string): string => {
    const found = props.settings?.statuses.find((s) => s.marker === marker);
    return found?.color ?? "#666";
  };

  // подпись колонки из настроек пользователя, иначе — как вернул бэкенд
  const labelOf = (marker: string, fallback: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ?? fallback;

  const limit = () => props.settings?.kanbanLimit ?? 50;

  const saveFilter = (f: KanbanFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      // игнорируем
    }
  };

  // клиентская фильтрация колонок/задач + порядок/видимость из настроек
  const visibleColumns = createMemo(() => {
    const f = filter();
    const q = f.search.trim().toLowerCase();
    const order = props.settings?.statuses ?? [];
    let cols = columns()
      .filter((col) => !(f.hideClosed && CLOSED_MARKERS.includes(col.marker)))
      .map((col) => ({
        ...col,
        label: labelOf(col.marker, col.label),
        tasks: col.tasks.filter((t) => {
          if (q && !t.content.toLowerCase().includes(q)) return false;
          if (f.page && t.page !== f.page) return false;
          return true;
        }),
      }));

    if (order.length) {
      cols = order
        .filter((st) => st.visible)
        .map((st) => cols.find((c) => c.marker === st.marker))
        .filter((c): c is TaskColumn => c !== undefined);
    }
    return cols;
  });

  const load = async () => {
    setLoading(true);
    try {
      setColumns(await kanban());
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    void props.refreshKey;
    void load();
  });

  // оптимистичное перемещение задачи между колонками
  const moveTo = (uuid: string, marker: string) => {
    setColumns((cols) =>
      cols.map((col) => {
        if (col.marker === marker) {
          const found = cols
            .flatMap((c) => c.tasks)
            .find((t) => t.uuid === uuid);
          if (!found || col.tasks.some((t) => t.uuid === uuid)) return col;
          return { ...col, tasks: [...col.tasks, { ...found, status: marker }] };
        }
        return { ...col, tasks: col.tasks.filter((t) => t.uuid !== uuid) };
      }),
    );
  };

  const onDrop = async (e: DragEvent, marker: string) => {
    e.preventDefault();
    setDragOver(null);
    const uuid = e.dataTransfer?.getData("text/plain");
    if (!uuid || busy()) return;
    setBusy(true);
    moveTo(uuid, marker);
    try {
      await taskSetStatus(uuid, marker);
    } catch (err) {
      console.error("не удалось сменить статус:", err);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="kanban">
      <div class="kanban-filters">
        <input
          class="kanban-filter-input"
          type="search"
          placeholder="поиск задач…"
          value={filter().search}
          onInput={(e) =>
            saveFilter({ ...filter(), search: e.currentTarget.value })
          }
        />
        <input
          class="kanban-filter-input"
          type="search"
          placeholder="страница…"
          value={filter().page}
          onInput={(e) =>
            saveFilter({ ...filter(), page: e.currentTarget.value })
          }
        />
        <label class="kanban-filter-check">
          <input
            type="checkbox"
            checked={filter().hideClosed}
            onChange={(e) =>
              saveFilter({ ...filter(), hideClosed: e.currentTarget.checked })
            }
          />
          <span>скрыть выполненные</span>
        </label>
      </div>
      <Show when={loading() && columns().length === 0}>
        <div class="muted">Загрузка задач…</div>
      </Show>
      <For each={visibleColumns()}>
        {(col) => (
          <section
            class="kanban-col"
            classList={{ "kanban-drop": dragOver() === col.marker }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(col.marker);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, col.marker)}
          >
            <header class="kanban-head">
              <span
                class="kanban-dot"
                style={{ background: colorOf(col.marker) }}
              />
              <span class="kanban-label">{col.label}</span>
              <span class="kanban-count">{col.tasks.length}</span>
            </header>
            <div class="kanban-body">
              <For each={col.tasks.slice(0, limit())}>
                {(task) => (
                  <TaskCard
                    task={task}
                    draggable
                    onOpenPage={props.onOpenPage}
                  />
                )}
              </For>
              <Show when={col.tasks.length === 0}>
                <div class="kanban-empty">перетащи сюда задачу</div>
              </Show>
              <Show when={col.tasks.length > limit()}>
                <div class="kanban-empty">
                  …и ещё {col.tasks.length - limit()}
                </div>
              </Show>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
