import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings, TaskDto } from "~/lib/api";
import {
  assetSave,
  blockDelete,
  blockSetProp,
  blockUpdateText,
  openExternal,
  taskSetPriority,
  taskSetQuadrant,
  taskSetStatus,
} from "~/lib/api";
import { editingBlock, setEditingBlock } from "~/lib/editState";
import { activeModalContext } from "~/lib/modalState";
import { commandForContext, effectiveShortcuts, normalizeShortcut, shouldHandleGlobalShortcut } from "~/lib/shortcuts";
import { primaryTaskElement, selectedTaskUuid, setSelectedTaskUuid, visibleTaskUuid } from "~/lib/taskNavigation";
import { editorSource, persistedSource } from "~/lib/text";
import { pasteImage, waitForImagePaste } from "~/lib/pasteImage";
import { fitTextarea } from "~/lib/textarea";
import { RichText } from "./RichText";
import { BlockMenu } from "./BlockMenu";
import { StatusPrioDot, MARKERS, STATUS_COLORS } from "./StatusPrioDot";

/** служебные свойства, не показываемые в карточке (видны в редакторе блока) */
const HIDDEN_PROPS = new Set([
  "urgency",
  "importance",
  "deadline",
  "source",
  "source-id",
  "synced-at",
]);

/** русские подписи известных свойств; неизвестные показываются как есть */
const PROP_LABELS: Record<string, string> = {
  assignee: "Исполнитель",
  author: "Автор",
  created: "Создана",
  url: "Ссылка",
  milestone: "Веха",
  "sync-conflict": "Конфликт синхронизации",
  "sync-missing": "Нет на сервере с",
};

/** свойства-даты: ISO → человекочитаемый вид */
const DATE_PROPS = new Set(["created", "sync-conflict", "sync-missing"]);

/** ISO-дата/время → «26 июля 2026»; не распарсилось — исходная строка */
function formatDate(v: string): string {
  // микросекунды из Python ISO усекаем до миллисекунд
  const norm = v.replace(/(\.\d{3})\d+/, "$1");
  const d = new Date(norm);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/** короткий текст ссылки: домен без схемы и пути */
function urlLabel(v: string): string {
  try {
    return new URL(v).hostname;
  } catch {
    return v;
  }
}

/** Карточка задачи (подборки/канбан/матрица): клик по тексту — инлайн-редактор,
 *  переход к файлу — только по имени страницы справа, правый клик — меню действий */
export function TaskCard(props: {
  task: TaskDto;
  onOpenPage?: (name: string, uuid?: string) => void;
  draggable?: boolean;
  /** развёрнутый вид (подборки): + таблица свойств блока */
  detailed?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  settings?: Settings | null;
  /** вызывается после смены статуса/приоритета/сохранения текста */
  onChanged?: () => void;
}): JSX.Element {
  const t = props.task;
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);

  /** открывает контекстное меню в точке клика (прижатие к границам — в BlockMenu) */
  const openMenu = (pos: { x: number; y: number }) => setMenuPos(pos);
  const [showChildren, setShowChildren] = createSignal(false);
  let textareaEl: HTMLTextAreaElement | undefined;
  let rootEl: HTMLDivElement | undefined;
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  const [pasteBusy, setPasteBusy] = createSignal(false);

  const onImagePaste = async (e: ClipboardEvent) => {
    const el = textareaEl;
    if (!el) return;
    setPasteError(null);
    setPasteBusy(true);
    const result = await pasteImage(e, el, assetSave);
    setPasteBusy(false);
    if (result.error) {
      setPasteError(result.error);
      return;
    }
    if (result.text !== undefined && result.caret !== undefined) {
      setDraft(result.text);
      queueMicrotask(() => {
        el.value = result.text!;
        el.setSelectionRange(result.caret!, result.caret!);
        fitTextarea(el);
      });
    }
  };

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

  const onDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", t.uuid);
    e.dataTransfer.effectAllowed = "move";
  };

  const startEdit = () => {
    setDraft(editorSource(t.source));
    setEditing(true);
    setEditingBlock(t.uuid);
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.focus();
      fitTextarea(el);
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
  };

  const stopEdit = () => {
    setEditing(false);
    if (editingBlock() === t.uuid) setEditingBlock(null);
  };

  onCleanup(() => {
    if (editingBlock() === t.uuid) setEditingBlock(null);
  });

  const saveEdit = async () => {
    if (saving()) return;
    if (textareaEl) await waitForImagePaste(textareaEl);
    const text = draft().trim();
    if (!text || text === editorSource(t.source).trim()) {
      stopEdit();
      return;
    }
    setSaving(true);
    try {
      await blockUpdateText(t.uuid, persistedSource(text));
      stopEdit();
      props.onChanged?.();
    } catch (e) {
      console.error("не удалось сохранить задачу:", e);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = async () => {
    if (textareaEl) await waitForImagePaste(textareaEl);
    stopEdit();
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

  onMount(() => {
    const isMac = navigator.platform.includes("Mac");
    const isPrimary = () => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-task-uuid]"));
      return primaryTaskElement(elements, t.uuid) === rootEl;
    };
    const runCommand = (id: string, arrowDirection: 1 | -1 | null = null) => {
      if (id === "taskNext" || id === "taskPrevious" || arrowDirection) {
        const direction = arrowDirection ?? (id === "taskNext" ? 1 : -1);
        const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-task-uuid]"));
        const uuid = visibleTaskUuid(elements, direction, t.uuid);
        if (uuid) {
          setSelectedTaskUuid(uuid);
          document.querySelector<HTMLElement>(`[data-task-uuid="${CSS.escape(uuid)}"]`)?.scrollIntoView({ block: "nearest" });
        }
      } else if (id === "taskOpen") {
        props.onOpenPage?.(t.page, t.uuid);
      } else if (id === "taskEdit") {
        startEdit();
      } else if (id === "taskMenu" && rootEl) {
        const rect = rootEl.getBoundingClientRect();
        openMenu({ x: rect.left + 24, y: rect.top + 24 });
      } else if (id === "taskToggleDone") {
        void onStatus(t.done ? "TODO" : "DONE");
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || editingBlock() !== null || activeModalContext() || selectedTaskUuid() !== t.uuid || !isPrimary()) return;
      const shortcut = normalizeShortcut(e, isMac);
      if (!shortcut || !shouldHandleGlobalShortcut(e.target, shortcut)) return;
      const effective = effectiveShortcuts(props.settings?.shortcuts ?? {});
      const id = commandForContext(shortcut, effective, "taskList");
      const arrowDirection = e.code === "ArrowDown" ? 1 : e.code === "ArrowUp" ? -1 : null;
      if (!id && !arrowDirection) return;
      e.preventDefault();
      if (id) runCommand(id, arrowDirection);
      else if (arrowDirection) runCommand("", arrowDirection);
    };
    const onPaletteCommand = (e: Event) => {
      if (activeModalContext() || editingBlock() !== null || selectedTaskUuid() !== t.uuid || !isPrimary()) return;
      runCommand((e as CustomEvent<string>).detail);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("logtask:task-command", onPaletteCommand);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("logtask:task-command", onPaletteCommand);
    });
  });

  return (
    <div
      ref={rootEl}
      class="task-card"
      data-task-uuid={t.uuid}
      classList={{
        "task-done": t.done,
        "task-prio-a": t.priority === "[#A]",
        "task-prio-b": t.priority === "[#B]",
        "task-selected": props.selected,
      }}
      title={editing() ? undefined : t.content}
      onClick={props.onSelect}
      draggable={props.draggable && !editing()}
      onDragStart={onDragStart}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div class="task-card-head">
        <StatusPrioDot
          status={t.status}
          priority={t.priority}
          urgency={t.urgency}
          importance={t.importance}
          settings={props.settings}
          onStatus={(m) => void onStatus(m)}
          onPriority={(p) => void onPriority(p)}
          onMenu={(pos) => openMenu(pos)}
        />
        <Show
          when={editing()}
          fallback={
            <div class="task-card-text" title="Редактировать" onClick={startEdit}>
              {t.content || t.extra.length > 0 ? (
                <RichText
                  text={[t.content, ...t.extra].join("\n")}
                  onOpenPage={props.onOpenPage}
                />
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
            disabled={saving() || pasteBusy()}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              fitTextarea(e.currentTarget);
            }}
            onPaste={(e) => void onImagePaste(e)}
            onKeyDown={(e) => {
              if (e.isComposing) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void saveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                void cancelEdit();
              }
            }}
            onBlur={() => void saveEdit()}
            rows={1}
          />
          <Show when={pasteBusy()}><div class="muted">Сохранение изображения…</div></Show>
          <Show when={pasteError()}>{(message) => <div class="error">{message()}</div>}</Show>
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
                selected={selectedTaskUuid() === c.uuid}
                onSelect={() => setSelectedTaskUuid(c.uuid)}
                onOpenPage={props.onOpenPage}
                settings={props.settings}
                onChanged={props.onChanged}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.detailed && t.props.some(([k]) => !HIDDEN_PROPS.has(k))}>
        <div class="task-props">
          <For each={t.props.filter(([k]) => !HIDDEN_PROPS.has(k))}>
            {([k, v]) => (
              <div class="task-prop">
                <span class="task-prop-key">{PROP_LABELS[k] ?? k}</span>
                <span class="task-prop-val">
                  {k === "milestone" ? (
                    <span class="task-prop-badge">{v}</span>
                  ) : /^https?:\/\//.test(v) ? (
                    <span
                      class="wikilink"
                      title={`Открыть в браузере: ${v}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openExternal(v);
                      }}
                    >
                      {urlLabel(v)}
                    </span>
                  ) : DATE_PROPS.has(k) ? (
                    <span title={v}>{formatDate(v)}</span>
                  ) : (
                    v
                  )}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={t.deadline}>
        {(d) => (
          <div class="task-card-meta">
            <span class="task-date">⏱ {d()}</span>
          </div>
        )}
      </Show>

      <Show when={menuPos()}>
        {(pos) => (
          <BlockMenu
            pos={pos()}
            onClose={() => setMenuPos(null)}
            status={t.status}
            priority={t.priority}
            urgency={t.urgency}
            importance={t.importance}
            task={true}
            settings={props.settings}
            onStatus={(m) => void onStatus(m)}
            onPriority={(p) => void onPriority(p)}
            onLevel={(k, l) => void onLevel(k, l)}
            onDeadline={() => void onDeadline()}
            onDelete={() => void onDelete()}
          />
        )}
      </Show>
    </div>
  );
}
