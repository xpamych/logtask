import { For, Show, createSignal, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { MatrixQuadrant } from "~/lib/api";
import { matrix, taskSetQuadrant } from "~/lib/api";
import { TaskCard } from "./TaskCard";

const QUADRANT_META: Record<
  string,
  { color: string; hint: string }
> = {
  do: { color: "var(--danger)", hint: "срочно и важно" },
  schedule: { color: "var(--accent)", hint: "важно, не срочно" },
  delegate: { color: "var(--warning)", hint: "срочно, не важно" },
  drop: { color: "var(--fg-muted)", hint: "не срочно и не важно" },
};

const PAGE_SIZE = 12;

export function Matrix(props: {
  refreshKey: number;
  onOpenPage: (name: string, uuid?: string) => void;
}): JSX.Element {
  const [quadrants, setQuadrants] = createSignal<MatrixQuadrant[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dragOver, setDragOver] = createSignal<string | null>(null);
  const [limits, setLimits] = createSignal<Record<string, number>>({});
  const [busy, setBusy] = createSignal(false);

  const load = async () => {
    setLoading(true);
    try {
      setQuadrants(await matrix());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    void props.refreshKey;
    void load();
  });

  const onDrop = async (e: DragEvent, q: MatrixQuadrant) => {
    e.preventDefault();
    setDragOver(null);
    const uuid = e.dataTransfer?.getData("text/plain");
    if (!uuid || busy()) return;
    setBusy(true);
    // оптимистично перемещаем задачу в целевой квадрант
    setQuadrants((qs) =>
      qs.map((item) => {
        if (item.key === q.key) {
          const found = qs.flatMap((c) => c.tasks).find((t) => t.uuid === uuid);
          if (!found || item.tasks.some((t) => t.uuid === uuid)) return item;
          return {
            ...item,
            tasks: [
              ...item.tasks,
              { ...found, urgency: q.urgency, importance: q.importance },
            ],
          };
        }
        return { ...item, tasks: item.tasks.filter((t) => t.uuid !== uuid) };
      }),
    );
    try {
      await taskSetQuadrant(uuid, q.urgency, q.importance);
    } catch (err) {
      console.error("не изменить квадрант:", err);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="matrix">
      <Show when={error()}>
        {(e) => <div class="error">{e()}</div>}
      </Show>
      <Show when={loading() && quadrants().length === 0}>
        <div class="muted">Загрузка задач…</div>
      </Show>
      <For each={quadrants()}>
        {(q) => {
          // неизвестный ключ квадранта не должен ронять рендер
          const meta = QUADRANT_META[q.key] ?? { color: "var(--fg-muted)", hint: "" };
          const limit = () => limits()[q.key] ?? PAGE_SIZE;
          const visible = () => q.tasks.slice(0, limit());
          return (
            <section
              class="matrix-cell"
              classList={{ "matrix-drop": dragOver() === q.key }}
              style={{ "--quad-color": meta.color }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(q.key);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, q)}
            >
              <header class="matrix-head">
                <span class="matrix-dot" />
                <span class="matrix-label">{q.label}</span>
                <span class="matrix-count">{q.tasks.length}</span>
              </header>
              <div class="matrix-hint">{meta.hint}</div>
              <div class="matrix-body">
                <For each={visible()}>
                  {(task) => (
                    <TaskCard
                      task={task}
                      draggable
                      onOpenPage={props.onOpenPage}
                    />
                  )}
                </For>
                <Show when={q.tasks.length === 0}>
                  <div class="kanban-empty">перетащи сюда задачу</div>
                </Show>
              </div>
              <Show when={q.tasks.length > limit()}>
                <button
                  class="matrix-more"
                  onClick={() =>
                    setLimits((l) => ({
                      ...l,
                      [q.key]: (l[q.key] ?? PAGE_SIZE) + PAGE_SIZE,
                    }))
                  }
                >
                  показать ещё {Math.min(PAGE_SIZE, q.tasks.length - limit())}…
                </button>
              </Show>
            </section>
          );
        }}
      </For>
    </div>
  );
}
