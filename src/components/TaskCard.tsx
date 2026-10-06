import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings, TaskDto } from "~/lib/api";
import {
  blockDelete,
  blockSetProp,
  blockUpdateText,
  openExternal,
  taskSetPriority,
  taskSetQuadrant,
  taskSetStatus,
} from "~/lib/api";
import { RichText } from "./RichText";
import {
  StatusPrioDot,
  MARKERS,
  MARKER_LABELS,
  PRIORITIES,
  STATUS_COLORS,
} from "./StatusPrioDot";

const LEVELS = ["low", "medium", "high"];
const LEVEL_LABELS: Record<string, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

/** Карточка задачи (подборки/канбан/матрица): клик по тексту — инлайн-редактор,
 *  переход к файлу — только по имени страницы справа, правый клик — меню действий */
export function TaskCard(props: {
  task: TaskDto;
  onOpenPage?: (name: string, uuid?: string) => void;
  draggable?: boolean;
  /** развёрнутый вид (подборки): + таблица свойств блока */
  detailed?: boolean;
  settings?: Settings | null;
  /** вызывается после смены статуса/приоритета/сохранения текста */
  onChanged?: () => void;
}): JSX.Element {
  const t = props.task;
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);
  const [showChildren, setShowChildren] = createSignal(false);
  let textareaEl: HTMLTextAreaElement | undefined;

  const childStatusColor = (marker: string | null): string =>
    (marker && props.settings?.statuses.find((s) => s.marker === marker)?.color) ||
    (marker ? STATUS_COLORS[marker] : undefined) ||
    "#888888";

  /** прогресс по вложенным задачам: сегменты по статусам в порядке MARKERS */
  const progress = () => {
    const total = t.children.length;
    if (total === 0) return null;
    const counts = new Map<string | null, number>();
    for (const c of t.children) counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
    const segments = [...counts.entries()]
      .map(([status, n]) => ({ status, n, pct: (n / total) * 100 }))
      .sort((a, b) => MARKERS.indexOf(a.status ?? "") - MARKERS.indexOf(b.status ?? ""));
    const done = t.children.filter((c) => c.done).length;
    return { segments, done, total };
  };

  const statusLabel = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ??
    MARKER_LABELS[marker] ??
    marker;

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", t.uuid);
    e.dataTransfer.effectAllowed = "move";
  };

  const startEdit = () => {
    setDraft(t.source);
    setEditing(true);
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
  };

  const saveEdit = async () => {
    if (saving()) return;
    const text = draft().trim();
    if (!text || text === t.source.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await blockUpdateText(t.uuid, text);
      setEditing(false);
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось сохранить задачу:", e);
    } finally {
      setSaving(false);
    }
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

  const onLevel = async (key: "urgency" | "importance", level: string | null) => {
    try {
      await taskSetQuadrant(
        t.uuid,
        key === "urgency" ? level : null,
        key === "importance" ? level : null,
      );
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось сменить уровень:", e);
    }
  };

  const onDeadline = async () => {
    const value = window.prompt("Дедлайн (YYYY-MM-DD, пусто — убрать):", t.deadline ?? "");
    if (value === null) return;
    try {
      await blockSetProp(t.uuid, "deadline", value.trim() || null);
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось поставить дедлайн:", e);
    }
  };

  const onDelete = async () => {
    if (!confirm(`Удалить блок «${t.content.slice(0, 60)}»?`)) return;
    try {
      await blockDelete(t.uuid);
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось удалить блок:", e);
    }
  };

  const levelRow = (key: "urgency" | "importance", title: string) => (
    <>
      <div class="block-menu-title">{title}</div>
      <For each={LEVELS}>
        {(l) => (
          <button
            class="block-menu-item"
            classList={{ active: (key === "urgency" ? t.urgency : t.importance) === l }}
            onClick={() => {
              setMenuPos(null);
              void onLevel(key, l);
            }}
          >
            {LEVEL_LABELS[l]}
          </button>
        )}
      </For>
      <button
        class="block-menu-item"
        onClick={() => {
          setMenuPos(null);
          void onLevel(key, null);
        }}
      >
        убрать
      </button>
    </>
  );

  return (
    <div
      class="task-card"
      classList={{
        "task-done": t.done,
        "task-prio-a": t.priority === "[#A]",
        "task-prio-b": t.priority === "[#B]",
      }}
      title={editing() ? undefined : t.content}
      draggable={props.draggable && !editing()}
      onDragStart={onDragStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      <div class="task-card-head">
        <StatusPrioDot
          status={t.status}
          priority={t.priority}
          settings={props.settings}
          onStatus={(m) => void onStatus(m)}
          onPriority={(p) => void onPriority(p)}
        />
        <Show
          when={editing()}
          fallback={
            <div class="task-card-text" title="Редактировать" onClick={startEdit}>
              {t.content ? (
                <RichText text={t.content} onOpenPage={props.onOpenPage} />
              ) : (
                <span class="muted">·</span>
              )}
            </div>
          }
        >
          <textarea
            ref={textareaEl}
            class="block-edit task-card-edit"
            value={draft()}
            disabled={saving()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.isComposing) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void saveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={() => void saveEdit()}
            rows={Math.max(1, draft().split("\n").length, Math.ceil(draft().length / 60))}
          />
        </Show>
        <span
          class="task-page"
          title={`Перейти к «${t.page}»`}
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenPage?.(t.page, t.uuid);
          }}
        >
          {t.page}
        </span>
      </div>
      <Show when={progress()}>
        {(p) => (
          <div class="task-progress-row">
            <div
              class="task-progress"
              title={`Вложенные задачи: выполнено ${p().done} из ${p().total}`}
            >
              <For each={p().segments}>
                {(s) => (
                  <span
                    class="task-progress-seg"
                    style={{ width: `${s.pct}%`, background: childStatusColor(s.status) }}
                  />
                )}
              </For>
            </div>
            <button
              class="task-progress-toggle"
              title={showChildren() ? "Скрыть вложенные" : "Показать вложенные"}
              onClick={(e) => {
                e.stopPropagation();
                setShowChildren((v) => !v);
              }}
            >
              <span class="caret">{showChildren() ? "▾" : "▸"}</span> {p().done}/{p().total}
            </button>
          </div>
        )}
      </Show>
      <Show when={showChildren() && t.children.length > 0}>
        <div class="task-children">
          <For each={t.children}>
            {(c) => (
              <TaskCard
                task={c}
                onOpenPage={props.onOpenPage}
                settings={props.settings}
                onChanged={props.onChanged}
              />
            )}
          </For>
        </div>
      </Show>
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

      <Show when={menuPos()}>
        {(pos) => (
          <>
            <div class="menu-backdrop" onClick={() => setMenuPos(null)} />
            <div
              class="block-menu ctx-menu"
              style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <div class="block-menu-title">Статус</div>
              <For each={MARKERS}>
                {(m) => (
                  <button
                    class="block-menu-item"
                    classList={{ active: t.status === m }}
                    onClick={() => {
                      setMenuPos(null);
                      void onStatus(m);
                    }}
                  >
                    {statusLabel(m)}
                  </button>
                )}
              </For>
              <div class="block-menu-title">Приоритет</div>
              <For each={PRIORITIES}>
                {(p) => (
                  <button
                    class="block-menu-item"
                    classList={{ active: t.priority === `[#${p}]` }}
                    onClick={() => {
                      setMenuPos(null);
                      void onPriority(p);
                    }}
                  >
                    {p === "A" ? "высокий" : p === "B" ? "средний" : "низкий"}
                  </button>
                )}
              </For>
              <button
                class="block-menu-item"
                onClick={() => {
                  setMenuPos(null);
                  void onPriority(null);
                }}
              >
                убрать приоритет
              </button>
              {levelRow("urgency", "Срочность")}
              {levelRow("importance", "Важность")}
              <div class="block-menu-title">Прочее</div>
              <button
                class="block-menu-item"
                onClick={() => {
                  setMenuPos(null);
                  void onDeadline();
                }}
              >
                Дедлайн…
              </button>
              <button
                class="block-menu-item danger"
                onClick={() => {
                  setMenuPos(null);
                  void onDelete();
                }}
              >
                Удалить блок
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
