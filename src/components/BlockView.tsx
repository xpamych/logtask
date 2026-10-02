import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { editingBlock, setEditingBlock } from "~/lib/editState";
import { RichText } from "./RichText";
import type { BlockDto, Settings } from "~/lib/api";
import {
  blockSetProp,
  blockUpdateText,
  clockStart,
  clockStop,
  pageList,
  taskSetPriority,
  taskSetQuadrant,
} from "~/lib/api";

const STATUS_COLORS: Record<string, string> = {
  LATER: "#888888",
  TODO: "#09bec8",
  DOING: "#ff9800",
  REVIEW: "#9b59b6",
  DONE: "#4caf50",
  CANCELED: "#f44336",
};

const QUADRANT_HINT: Record<string, string> = {
  high: "▲",
  medium: "◆",
  low: "·",
};

const MARKERS = ["TODO", "DOING", "LATER", "REVIEW", "DONE", "CANCELED"];
const MARKER_LABELS: Record<string, string> = {
  LATER: "Бэклог",
  TODO: "К выполнению",
  DOING: "В работе",
  REVIEW: "На проверке",
  DONE: "Выполнено",
  CANCELED: "Отменено",
};
const PRIORITIES = ["A", "B", "C"];
const LEVELS = ["low", "medium", "high"];
const LEVEL_LABELS: Record<string, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

export function BlockView(props: {
  block: BlockDto;
  onOpenPage?: (name: string) => void;
  onChanged?: () => void;
  onStatusChange?: (uuid: string, marker: string) => void;
  onDelete?: (uuid: string) => void | Promise<void>;
  settings?: Settings | null;
}): JSX.Element {
  const b = props.block;
  const onOpen = props.onOpenPage;

  // подпись статуса: из настроек пользователя, иначе дефолт
  const statusLabel = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ??
    MARKER_LABELS[marker] ??
    marker;

  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [menu, setMenu] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [acItems, setAcItems] = createSignal<string[]>([]);
  const [acOpen, setAcOpen] = createSignal(false);
  const [acIndex, setAcIndex] = createSignal(0);
  let textareaEl: HTMLTextAreaElement | undefined;
  let allPages: string[] | null = null;

  /// автодополнение: найти незакрытое [[ в тексте
  const autocompleteQuery = (text: string): string | null => {
    const lastOpen = text.lastIndexOf("[[");
    if (lastOpen === -1) return null;
    const after = text.slice(lastOpen + 2);
    if (after.includes("]]")) return null;
    if (after.includes("\n")) return null;
    return after;
  };

  const onEditInput = async (e: HTMLTextAreaElement) => {
    setDraft(e.value);
    const q = autocompleteQuery(e.value);
    if (q === null) {
      setAcOpen(false);
      return;
    }
    // перечитываем список страниц при каждом открытии автодополнения — дёшево
    // и не даёт кэшу устареть
    if (!acOpen() || allPages === null) {
      try {
        allPages = await pageList();
      } catch {
        allPages = [];
      }
    }
    const lq = q.toLowerCase();
    const hits = allPages
      .filter((p) => p.toLowerCase().includes(lq))
      .slice(0, 6);
    setAcItems(hits);
    setAcIndex(0);
    setAcOpen(hits.length > 0);
  };

  const acceptAutocomplete = (name: string) => {
    const text = draft();
    const lastOpen = text.lastIndexOf("[[");
    if (lastOpen === -1) return;
    const replaced = text.slice(0, lastOpen + 2) + name + "]]";
    setDraft(replaced);
    setAcOpen(false);
    queueMicrotask(() => {
      const el = textareaEl;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const startEdit = () => {
    setDraft(b.content);
    setEditing(true);
    setEditingBlock(b.uuid);
    queueMicrotask(() => textareaEl?.focus());
  };

  /// выход из режима редактирования: сброс локального и общего состояния
  const stopEdit = () => {
    setEditing(false);
    if (editingBlock() === b.uuid) setEditingBlock(null);
  };

  // размонтирование во время редактирования не должно блокировать
  // отложенные перезагрузки по graph-changed
  onCleanup(() => {
    if (editingBlock() === b.uuid) setEditingBlock(null);
  });

  const save = async () => {
    // Enter прячет textarea → WebKit шлёт blur → повторный save: пропускаем
    if (saving()) return;
    const text = draft().trim();
    if (!text || text === b.content) {
      stopEdit();
      return;
    }
    setSaving(true);
    try {
      await blockUpdateText(b.uuid, text);
      stopEdit();
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка сохранения:", e);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    stopEdit();
    setDraft(b.content);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // IME-композиция: Enter подтверждает ввод, а не сохранение
    if (e.isComposing) return;
    // навигация по автодополнению
    if (acOpen()) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAcIndex((i) => (i + 1) % acItems().length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAcIndex((i) => (i - 1 + acItems().length) % acItems().length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        acceptAutocomplete(acItems()[acIndex()]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAcOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onClockToggle = async () => {
    setMenu(false);
    try {
      if (b.clockRunning) {
        await clockStop(b.uuid);
      } else {
        await clockStart(b.uuid);
      }
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка CLOCK:", e);
    }
  };

  const onPriority = async (prio: string | null) => {
    setMenu(false);
    try {
      await taskSetPriority(b.uuid, prio);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка приоритета:", e);
    }
  };

  const onLevel = async (key: "urgency" | "importance", level: string) => {
    setMenu(false);
    try {
      await taskSetQuadrant(
        b.uuid,
        key === "urgency" ? level : null,
        key === "importance" ? level : null,
      );
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка уровня:", e);
    }
  };

  const onDeadline = async () => {
    setMenu(false);
    const value = window.prompt(
      "Дедлайн (YYYY-MM-DD):",
      b.deadline ?? "",
    );
    if (value === null) return;
    try {
      await blockSetProp(b.uuid, "deadline", value.trim() || null);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка deadline:", e);
    }
  };

  // мод+enter — меню быстрого редактирования
  const onBlockKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setMenu((v) => !v);
    }
  };

  return (
    <div
      class="block"
      classList={{ "block-task": b.task }}
      data-uuid={b.uuid || undefined}
      style={{ "padding-left": `${10 + b.indent * 22}px` }}
      tabindex={-1}
      onKeyDown={onBlockKeyDown}
    >
      <span
        class="status-dot"
        style={{
          background: b.status ? (STATUS_COLORS[b.status] ?? "#888888") : "transparent",
          visibility: b.status ? "visible" : "hidden",
        }}
        title={b.status ? statusLabel(b.status) : ""}
      />
      <div class="block-content">
        <Show
          when={editing()}
          fallback={
            <span class="block-text" onClick={startEdit}>
              <RichText text={b.content} onOpenPage={onOpen} />
              <Show when={b.extra.length > 0}>
                <span class="block-extra">
                  <RichText text={b.extra.join("\n")} onOpenPage={onOpen} />
                </span>
              </Show>
            </span>
          }
        >
          <textarea
            ref={textareaEl}
            class="block-edit"
            value={draft()}
            disabled={saving()}
            onInput={(e) => void onEditInput(e.currentTarget)}
            onKeyDown={onKeyDown}
            onBlur={() => void save()}
            rows={Math.max(
              1,
              draft().split("\n").length,
              Math.ceil(draft().length / 60),
            )}
          />
          <Show when={acOpen()}>
            <div class="ac-list">
              <For each={acItems()}>
                {(name, i) => (
                  <button
                    class="ac-item"
                    classList={{ active: i() === acIndex() }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptAutocomplete(name);
                    }}
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
      {(b.urgency || b.importance) && (
        <span
          class="quad-hint"
          title={`срочность: ${b.urgency ?? "-"}, важность: ${b.importance ?? "-"}`}
        >
          {b.urgency && QUADRANT_HINT[b.urgency]}
          {b.importance && QUADRANT_HINT[b.importance]}
        </span>
      )}
      {b.priority && <span class="priority-badge">{b.priority}</span>}
      <Show when={b.clockRunning}>
        <span class="clock-running" title="идёт отсчёт времени">
          ●
        </span>
      </Show>
      <Show when={b.clockTotal}>
        {(t) => <span class="clock-total" title="отработано">⏱ {t()}</span>}
      </Show>
      <Show when={!editing()}>
        <span class="block-actions">
          <button class="block-action" title="Редактировать" onClick={startEdit}>
            ✎
          </button>
          <Show when={b.task || b.clockRunning}>
            <button
              class="block-action"
              classList={{ active: b.clockRunning }}
              title={b.clockRunning ? "Остановить таймер" : "Начать учёт времени"}
              onClick={onClockToggle}
            >
              {b.clockRunning ? "⏹" : "▶"}
            </button>
          </Show>
          <button
            class="block-action"
            title="Меню задачи (mod+enter)"
            onClick={() => setMenu((v) => !v)}
          >
            ⋯
          </button>
          <button
            class="block-action danger"
            title="Удалить блок"
            onClick={() => {
              if (confirm(`Удалить блок «${b.content.slice(0, 60)}»?`)) {
                void props.onDelete?.(b.uuid);
              }
            }}
          >
            ✕
          </button>
        </span>
      </Show>
      <Show when={menu()}>
        <div class="block-menu">
          <div class="block-menu-title">Статус</div>
          <div class="block-menu-row">
            <For each={MARKERS}>
              {(m) => (
                <button
                  class="block-menu-item"
                  classList={{ active: b.status === m }}
                  onClick={() => {
                    setMenu(false);
                    props.onStatusChange?.(b.uuid, m);
                  }}
                >
                  {statusLabel(m)}
                </button>
              )}
            </For>
          </div>

          <div class="block-menu-title">Приоритет</div>
          <div class="block-menu-row">
            <For each={PRIORITIES}>
              {(p) => (
                <button
                  class="block-menu-item"
                  classList={{ active: b.priority === `[#${p}]` }}
                  onClick={() => onPriority(p)}
                >
                  [#{p}]
                </button>
              )}
            </For>
            <Show when={b.priority}>
              <button class="block-menu-item" onClick={() => onPriority(null)}>
                убрать
              </button>
            </Show>
          </div>

          <div class="block-menu-title">Срочность</div>
          <div class="block-menu-row">
            <For each={LEVELS}>
              {(l) => (
                <button
                  class="block-menu-item"
                  classList={{ active: b.urgency === l }}
                  onClick={() => onLevel("urgency", l)}
                >
                  {LEVEL_LABELS[l]}
                </button>
              )}
            </For>
          </div>

          <div class="block-menu-title">Важность</div>
          <div class="block-menu-row">
            <For each={LEVELS}>
              {(l) => (
                <button
                  class="block-menu-item"
                  classList={{ active: b.importance === l }}
                  onClick={() => onLevel("importance", l)}
                >
                  {LEVEL_LABELS[l]}
                </button>
              )}
            </For>
          </div>

          <div class="block-menu-title">Дедлайн</div>
          <div class="block-menu-row">
            <button class="block-menu-item" onClick={onDeadline}>
              {b.deadline ? `изменить (${b.deadline})` : "установить"}
            </button>
            <Show when={b.deadline}>
              <button
                class="block-menu-item"
                onClick={() => {
                  setMenu(false);
                  void blockSetProp(b.uuid, "deadline", null).then(() =>
                    props.onChanged?.(),
                  );
                }}
              >
                убрать
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
