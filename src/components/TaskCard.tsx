import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { TaskDto } from "~/lib/api";
import { openExternal } from "~/lib/api";
import { RichText } from "./RichText";

export function TaskCard(props: {
  task: TaskDto;
  onOpenPage?: (name: string, uuid?: string) => void;
  draggable?: boolean;
  /** развёрнутый вид (подборки): чип статуса и свойства блока */
  detailed?: boolean;
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
      classList={{
        "task-done": t.done,
        "task-prio-a": t.priority === "[#A]",
        "task-prio-b": t.priority === "[#B]",
      }}
      title={t.content}
      draggable={props.draggable}
      onDragStart={onDragStart}
      onClick={() => props.onOpenPage?.(t.page, t.uuid)}
    >
      <div class="task-card-text">
        <Show when={props.detailed && t.statusLabel}>
          {(l) => <span class="task-status-chip">{l()}</span>}
        </Show>
        {t.content
          ? <RichText text={t.content} onOpenPage={props.onOpenPage} />
          : <span class="muted">·</span>}
      </div>
      <Show when={props.detailed && t.props.length > 0}>
        <div class="task-props">
          <For each={t.props}>
            {([k, v]) => (
              <div class="task-prop">
                <span class="task-prop-key">{k}</span>
                <span class="task-prop-val">
                  {/^https?:\/\//.test(v) ? (
                    <span
                      class="wikilink"
                      title={`Открыть в браузере: ${v}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openExternal(v);
                      }}
                    >
                      {v}
                    </span>
                  ) : (
                    v
                  )}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
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
