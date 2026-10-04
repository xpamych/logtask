import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings, TaskDto } from "~/lib/api";
import { openExternal, taskSetPriority, taskSetStatus } from "~/lib/api";
import { RichText } from "./RichText";
import { StatusPrioDot } from "./StatusPrioDot";

export function TaskCard(props: {
  task: TaskDto;
  onOpenPage?: (name: string, uuid?: string) => void;
  draggable?: boolean;
  /** развёрнутый вид (подборки): + таблица свойств блока */
  detailed?: boolean;
  settings?: Settings | null;
  /** вызывается после смены статуса/приоритета из кружка */
  onChanged?: () => void;
}): JSX.Element {
  const t = props.task;

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", t.uuid);
    e.dataTransfer.effectAllowed = "move";
  };

  const onStatus = async (marker: string) => {
    try {
      await taskSetStatus(t.uuid, marker);
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось сменить статус:", e);
    }
  };

  const onPriority = async (prio: string | null) => {
    try {
      await taskSetPriority(t.uuid, prio);
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось сменить приоритет:", e);
    }
  };

  return (
    <div
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
      <div class="task-card-head">
        <StatusPrioDot
          status={t.status}
          priority={t.priority}
          settings={props.settings}
          onStatus={(m) => void onStatus(m)}
          onPriority={(p) => void onPriority(p)}
        />
        <div class="task-card-text">
          {t.content
            ? <RichText text={t.content} onOpenPage={props.onOpenPage} />
            : <span class="muted">·</span>}
        </div>
        <span class="task-page" title={t.page}>{t.page}</span>
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
      <Show when={t.urgency || t.importance || t.deadline}>
        <div class="task-card-meta">
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
      </Show>
    </div>
  );
}
