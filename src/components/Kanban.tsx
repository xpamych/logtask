import { For, Show, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { TaskColumn } from "~/lib/api";
import { kanban } from "~/lib/api";
import { TaskCard } from "./TaskCard";

const COLUMN_ACCENTS: Record<string, string> = {
  LATER: "#8ba8b5",
  TODO: "#106ba3",
  DOING: "#d9822b",
  REVIEW: "#8a6d3b",
  DONE: "#3d8a4e",
  CANCELED: "#a05252",
};

export function Kanban(props: {
  refreshKey: number;
  onOpenPage: (name: string) => void;
}): JSX.Element {
  const [columns, setColumns] = createSignal<TaskColumn[]>([]);
  const [loading, setLoading] = createSignal(false);

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

  return (
    <div class="kanban">
      <Show when={loading() && columns().length === 0}>
        <div class="muted">Загрузка задач…</div>
      </Show>
      <For each={columns()}>
        {(col) => (
          <section class="kanban-col">
            <header class="kanban-head">
              <span
                class="kanban-dot"
                style={{ background: COLUMN_ACCENTS[col.marker] ?? "#666" }}
              />
              <span class="kanban-label">{col.label}</span>
              <span class="kanban-count">{col.tasks.length}</span>
            </header>
            <div class="kanban-body">
              <For each={col.tasks.slice(0, 50)}>
                {(task) => (
                  <TaskCard task={task} onOpenPage={props.onOpenPage} />
                )}
              </For>
              <Show when={col.tasks.length === 0}>
                <div class="kanban-empty">—</div>
              </Show>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
