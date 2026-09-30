import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { TaskDto } from "~/lib/api";

export function TaskCard(props: {
  task: TaskDto;
  onOpenPage?: (name: string, uuid?: string) => void;
  draggable?: boolean;
}): JSX.Element {
  const t = props.task;

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", t.uuid);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <button
      class="task-card"
      classList={{ "task-done": t.done }}
      title={t.content}
      draggable={props.draggable}
      onDragStart={onDragStart}
      onClick={() => props.onOpenPage?.(t.page, t.uuid)}
    >
      <div class="task-card-text">{t.content || <span class="muted">·</span>}</div>
      <div class="task-card-meta">
        <span class="task-page">{t.page}</span>
        <Show when={t.priority}>
          {(p) => <span class="task-priority">{p()}</span>}
        </Show>
        <Show when={t.urgency}>
          {(u) => <span class="task-flag" title="срочность">⚡{u()}</span>}
        </Show>
        <Show when={t.importance}>
          {(i) => <span class="task-flag" title="важность">★{i()}</span>}
        </Show>
        <Show when={t.deadline}>
          {(d) => <span class="task-date">⏱ {d()}</span>}
        </Show>
      </div>
      <Show when={t.tags.length > 0}>
        <div class="task-tags">
          <For each={t.tags.slice(0, 4)}>{(tag) => <span class="task-tag">#{tag}</span>}</For>
        </div>
      </Show>
    </button>
  );
}
