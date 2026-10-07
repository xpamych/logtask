import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { editingBlock, pendingEdit, setEditingBlock, setPendingEdit } from "~/lib/editState";
import { RichText } from "./RichText";
import { BlockMenu } from "./BlockMenu";
import { StatusPrioDot } from "./StatusPrioDot";
import type { BlockDto, Settings } from "~/lib/api";
import {
  blockIndent,
  blockMergeDown,
  blockMergeUp,
  blockOutdent,
  blockSetProp,
  blockSplit,
  blockUpdateText,
  clockStart,
  clockStop,
  pageList,
  taskSetPriority,
  taskSetQuadrant,
} from "~/lib/api";

const QUADRANT_HINT: Record<string, string> = {
  high: "▲",
  medium: "◆",
  low: "·",
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

  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
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
    // редактор правит блок целиком (как в Logseq): контент + продолжения
    setDraft(b.source);
    setEditing(true);
    setEditingBlock(b.uuid);
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.focus();
      // фокус ставит каретку в конец текста и ускролливает большой блок —
      // возвращаем курсор и скролл в начало
      el.setSelectionRange(0, 0);
      el.scrollTop = 0;
    });
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

  // Shift+Tab: WebKitGTK не отдаёт клавишу в DOM, её ловит Rust и шлёт
  // событие — реагирует только редактируемый сейчас блок
  onMount(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("editor-shift-tab", () => {
          if (!editing() || editingBlock() !== b.uuid) return;
          void moveIndent(true, textareaEl?.selectionStart ?? 0);
        });
      } catch {
        /* вне Tauri */
      }
    })();
    onCleanup(() => unlisten?.());
  });

  const save = async () => {
    // Enter прячет textarea → WebKit шлёт blur → повторный save: пропускаем
    if (saving()) return;
    const text = draft().trim();
    if (!text || text === b.source.trim()) {
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
    setDraft(b.source);
  };

  // продолжение редактирования после склейки: страница перезагрузилась,
  // этот экземпляр — выживший блок (uuid из pendingEdit) → сразу входим
  // в редактирование и ставим курсор в точку стыка
  {
    const pending = pendingEdit();
    if (pending && pending.uuid === b.uuid) {
      setPendingEdit(null);
      startEdit();
      queueMicrotask(() => {
        const el = textareaEl;
        if (!el) return;
        const firstLineLen = el.value.split("\n")[0].length;
        const pos = pending.at ?? Math.max(0, firstLineLen - (pending.minus ?? 0));
        el.setSelectionRange(pos, pos);
      });
    }
  }

  /// Backspace в самом начале блока: склеивание с вышестоящим (как в Logseq).
  /// Редактирование продолжается уже в склеенном блоке (новый uuid),
  /// курсор — в точке стыка
  const mergeUp = async () => {
    const movedLen = draft().split("\n")[0].trim().length;
    try {
      const res = await blockMergeUp(b.uuid);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, minus: movedLen });
        props.onChanged?.();
      }
      // первый блок страницы — не с кем, остаёмся в редактировании
    } catch (e) {
      console.error("склеивание блока:", e);
    }
  };

  /// Delete в конце блока: нижестоящий приклеивается к текущему
  const mergeDown = async () => {
    const at = draft().split("\n")[0].length;
    try {
      const res = await blockMergeDown(b.uuid);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, at });
        props.onChanged?.();
      }
      // последний блок — не с кем, остаёмся в редактировании
    } catch (e) {
      console.error("склеивание с нижестоящим:", e);
    }
  };

  /// Tab / Shift+Tab: вложенность блока (как в Logseq), курсор на месте
  const moveIndent = async (out: boolean, at: number) => {
    try {
      const res = out ? await blockOutdent(b.uuid) : await blockIndent(b.uuid);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, at });
        props.onChanged?.();
      }
      // первый сосед/верхний уровень — некуда, остаёмся как есть
    } catch (e) {
      console.error("смена вложенности:", e);
    }
  };

  /// Enter в редакторе (как в Logseq): текущий черновик делится по курсору —
  /// текст до курсора остаётся в блоке, текст после уходит в новый блок ниже;
  /// редактирование продолжается уже в новом блоке (курсор в начале)
  const splitBlock = async (start: number, end: number) => {
    const text = draft();
    const before = text.slice(0, start);
    const after = text.slice(end);
    try {
      const res = await blockSplit(b.uuid, before, after);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, at: 0 });
        props.onChanged?.();
      }
    } catch (e) {
      console.error("разбиение блока:", e);
    }
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
    // Tab / Shift+Tab — вложенность блока (текст не меняется, курсор на месте)
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget as HTMLTextAreaElement;
      void moveIndent(e.shiftKey, el.selectionStart);
      return;
    }
    // Backspace в позиции 0 (ничего не выделено) — склеивание с блоком выше;
    // Delete в конце текста — приклеить нижестоящий блок к текущему
    if (e.key === "Backspace" || e.key === "Delete") {
      const el = e.currentTarget as HTMLTextAreaElement;
      if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault();
        void mergeUp();
        return;
      }
      if (
        e.key === "Delete" &&
        el.selectionStart === el.value.length &&
        el.selectionEnd === el.value.length
      ) {
        e.preventDefault();
        void mergeDown();
        return;
      }
    }
    // Enter — новый блок ниже (с разбиением текста по курсору),
    // mod+Enter — сохранить, Escape — отмена
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void save();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget as HTMLTextAreaElement;
      void splitBlock(el.selectionStart, el.selectionEnd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onClockToggle = async () => {
    setMenu(null);
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
    setMenu(null);
    try {
      await taskSetPriority(b.uuid, prio);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка приоритета:", e);
    }
  };

  const onLevel = async (key: "urgency" | "importance", level: string | null) => {
    setMenu(null);
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
    setMenu(null);
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

  // мод+enter — контекстное меню блока (открывается у самого блока)
  const onBlockKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu(menu() ? null : { x: rect.left, y: rect.bottom + 4 });
    }
  };

  // правая кнопка — контекстное меню в точке клика (вне режима редактирования)
  const onContextMenu = (e: MouseEvent) => {
    if (editing()) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onDeleteBlock = () => {
    setMenu(null);
    if (confirm(`Удалить блок «${b.content.slice(0, 60)}»?`)) {
      void props.onDelete?.(b.uuid);
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
      onContextMenu={onContextMenu}
    >
      <StatusPrioDot
        status={b.status}
        priority={b.priority}
        urgency={b.urgency}
        importance={b.importance}
        settings={props.settings}
        onStatus={(m) => props.onStatusChange?.(b.uuid, m)}
        onPriority={(p) => void onPriority(p)}
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
      <Show when={b.clockRunning}>
        <span class="clock-running" title="идёт отсчёт времени">
          ●
        </span>
      </Show>
      <Show when={b.clockTotal}>
        {(t) => <span class="clock-total" title="отработано">⏱ {t()}</span>}
      </Show>
      <Show when={menu()}>
        {(pos) => (
          <BlockMenu
            pos={pos()}
            onClose={() => setMenu(null)}
            status={b.status}
            priority={b.priority}
            urgency={b.urgency}
            importance={b.importance}
            task={b.task}
            clockRunning={b.clockRunning}
            settings={props.settings}
            onStatus={(m) => props.onStatusChange?.(b.uuid, m)}
            onPriority={(p) => void onPriority(p)}
            onLevel={(k, l) => void onLevel(k, l)}
            onDeadline={() => void onDeadline()}
            onDelete={onDeleteBlock}
            onClockToggle={b.task ? () => void onClockToggle() : undefined}
          />
        )}
      </Show>
    </div>
  );
}
