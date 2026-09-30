import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { parseSegments } from "~/lib/text";
import type { BlockDto } from "~/lib/api";
import {
  blockUpdateText,
  clockStart,
  clockStop,
  pageList,
} from "~/lib/api";

const STATUS_COLORS: Record<string, string> = {
  LATER: "#8ba8b5",
  TODO: "#106ba3",
  DOING: "#d9822b",
  REVIEW: "#8a6d3b",
  DONE: "#3d8a4e",
  CANCELED: "#a05252",
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

export function BlockView(props: {
  block: BlockDto;
  onOpenPage?: (name: string) => void;
  onChanged?: () => void;
  onStatusChange?: (uuid: string, marker: string) => void;
  onDelete?: (uuid: string) => void | Promise<void>;
}): JSX.Element {
  const b = props.block;
  const onOpen = props.onOpenPage;

  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [menu, setMenu] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [acItems, setAcItems] = createSignal<string[]>([]);
  const [acOpen, setAcOpen] = createSignal(false);
  const [acIndex, setAcIndex] = createSignal(0);
  let textareaEl: HTMLTextAreaElement | undefined;
  let allPages: string[] | null = null;

  const segments = () => parseSegments(b.content.trim());

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
    if (allPages === null) {
      allPages = await pageList();
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
    queueMicrotask(() => textareaEl?.focus());
  };

  const save = async () => {
    const text = draft().trim();
    if (!text || text === b.content) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await blockUpdateText(b.uuid, text);
      setEditing(false);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка сохранения:", e);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(b.content);
  };

  const onKeyDown = (e: KeyboardEvent) => {
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
          background: b.status ? (STATUS_COLORS[b.status] ?? "#666") : "transparent",
          visibility: b.status ? "visible" : "hidden",
        }}
        title={b.statusLabel ?? b.status ?? ""}
      />
      <div class="block-content">
        <Show
          when={editing()}
          fallback={
            <span class="block-text" onDblClick={startEdit}>
              {segments().map((seg) => {
                if (seg.type === "link" || seg.type === "tag") {
                  return (
                    <button
                      class={seg.type === "link" ? "wikilink" : "hashtag"}
                      title={`Открыть «${seg.target}»`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen?.(seg.target ?? "");
                      }}
                    >
                      {seg.type === "link" ? `[[${seg.text}]]` : seg.text}
                    </button>
                  );
                }
                return <span>{seg.text}</span>;
              })}
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
            rows={Math.max(1, Math.ceil(draft().length / 60))}
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
          <button
            class="block-action"
            classList={{ active: b.clockRunning }}
            title={b.clockRunning ? "Остановить таймер" : "Начать учёт времени"}
            onClick={onClockToggle}
          >
            {b.clockRunning ? "⏹" : "▶"}
          </button>
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
                  {MARKER_LABELS[m]}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
