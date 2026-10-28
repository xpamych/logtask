import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { editingBlock, pendingEdit, setEditingBlock, setPendingEdit } from "~/lib/editState";
import { clickCaretPosition, renderSourceMap } from "~/lib/text";
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
  /** переход кареткой на соседний блок (стрелки в редакторе);
   *  возвращает false, если соседа нет */
  onNavigate?: (uuid: string, dir: -1 | 1) => boolean;
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

  /** длина текста (в символах) от начала root до DOM-точки (node, offset) */
  const domOffset = (root: HTMLElement, node: Node, offset: number): number => {
    const r = document.createRange();
    r.selectNodeContents(root);
    r.setEnd(node, offset);
    return r.toString().length;
  };

  /** позиция каретки в extra-строках → смещение в b.source: в исходнике
   *  у extra-строк есть отступы, а между ними — строки свойств/логбука;
   *  каждую extra-строку матчим по тексту к её строке исходника */
  const extraToSource = (off: number): number => {
    const joined = b.extra.join("\n");
    const map = renderSourceMap(joined);
    const pos = map[Math.min(off, map.length - 1)];
    const lines = joined.split("\n");
    let lineIdx = 0;
    let col = pos;
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (pos <= acc + lines[i].length) {
        lineIdx = i;
        col = Math.min(pos - acc, lines[i].length);
        break;
      }
      acc += lines[i].length + 1;
      lineIdx = i;
      col = lines[i].length;
    }
    // ищем строку исходника, соответствующую extra[lineIdx]: пропускаем
    // свойства/логбук/пустые, у Raw-строк в исходнике есть префикс-отступ
    const srcLines = b.source.split("\n");
    let extraIdx = 0;
    let lineStart = srcLines[0].length + 1;
    for (let j = 1; j < srcLines.length; j++) {
      const l = srcLines[j];
      const t = l.trimStart();
      const structural =
        t === "" ||
        t.startsWith(":LOGBOOK:") ||
        t.startsWith(":END:") ||
        t.startsWith("CLOCK:") ||
        /^[^\s:]+::/.test(t);
      if (!structural && l.endsWith(b.extra[extraIdx])) {
        if (extraIdx === lineIdx) {
          const indentLen = l.length - b.extra[extraIdx].length;
          return lineStart + indentLen + col;
        }
        extraIdx++;
      }
      lineStart += l.length + 1;
    }
    return b.source.length;
  };

  /** DOM-каретка после клика → смещение в редактируемом исходнике блока */
  const caretToSource = (container: HTMLElement, node: Node, offset: number): number => {
    // edit_source = [приоритет "[#X] "] + content + продолжения
    const prioLen = /^\[#.\]\s*/.exec(b.source)?.[0].length ?? 0;
    const anchorEl =
      node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const extraEl = container.querySelector(".block-extra");
    if (extraEl && anchorEl && extraEl.contains(anchorEl)) {
      return extraToSource(domOffset(extraEl as HTMLElement, node, offset));
    }
    const map = renderSourceMap(b.content);
    const off = Math.min(domOffset(container, node, offset), map.length - 1);
    return prioLen + map[off];
  };

  const startEdit = (e?: MouseEvent) => {
    // клик по тексту: браузер сам ставит DOM-каретку в точный символ —
    // читаем её ДО того, как редактор подменит разметку
    let clickPos: number | null = null;
    if (e) {
      const container = e.currentTarget as HTMLElement;
      const sel = window.getSelection();
      if (sel?.anchorNode && container.contains(sel.anchorNode)) {
        const visibleOffset = domOffset(container, sel.anchorNode, sel.anchorOffset);
        clickPos = clickCaretPosition(
          caretToSource(container, sel.anchorNode, sel.anchorOffset),
          visibleOffset,
          container.textContent?.length ?? 0,
          b.source.length,
        );
      }
    }
    // редактор правит блок целиком (как в Logseq): контент + продолжения
    setDraft(b.source);
    setEditing(true);
    setEditingBlock(b.uuid);
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      el.focus();
      // фокус ставит каретку в конец текста и ускролливает большой блок —
      // возвращаем скролл в начало; курсор — в точку клика (или в начало)
      const pos = Math.min(clickPos ?? 0, el.value.length);
      el.setSelectionRange(pos, pos);
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

  // вход в редактирование по сигналу через pendingEdit: продолжение после
  // склейки/разбиения (страница перезагрузилась, это выживший блок) или
  // навигация стрелками от соседнего блока (тот уже смонтирован — поэтому
  // эффект, а не разовая проверка в теле компонента)
  createEffect(() => {
    const pending = pendingEdit();
    if (!pending || pending.uuid !== b.uuid || editing()) return;
    setPendingEdit(null);
    startEdit();
    queueMicrotask(() => {
      const el = textareaEl;
      if (!el) return;
      const lines = el.value.split("\n");
      let pos: number;
      if (pending.atLine !== undefined || pending.minusLines !== undefined) {
        // курсор в начало строки стыка (склейка теперь многострочная)
        const idx = pending.atLine ?? lines.length - (pending.minusLines ?? 0);
        const clamped = Math.min(Math.max(0, idx), lines.length - 1);
        pos = lines.slice(0, clamped).reduce((s, l) => s + l.length + 1, 0);
      } else {
        pos = Math.min(pending.at ?? 0, el.value.length);
      }
      el.setSelectionRange(pos, pos);
    });
  });

  /// Backspace в самом начале блока: склеивание с вышестоящим (как в Logseq).
  /// Редактирование продолжается уже в склеенном блоке (новый uuid),
  /// курсор — в точке стыка
  const mergeUp = async () => {
    // строки черновика: первая станет отдельной строкой после вышестоящего
    // блока, за ней — trailing; стык = начало строки «curLines-я с конца»
    const curLines = draft().split("\n").length;
    try {
      const res = await blockMergeUp(b.uuid);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, minusLines: curLines });
        props.onChanged?.();
      }
      // первый блок страницы — не с кем, остаёмся в редактировании
    } catch (e) {
      console.error("склеивание блока:", e);
    }
  };

  /// Delete в конце блока: нижестоящий приклеивается к текущему
  const mergeDown = async () => {
    // стык = первая строка, которую добавит нижестоящий блок
    const atLine = draft().split("\n").length;
    try {
      const res = await blockMergeDown(b.uuid);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, atLine });
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
    // Стрелка вверх на первой строке / вниз на последней — переход
    // в соседний блок (в конец предыдущего / начало следующего), как в Logseq
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      props.onNavigate
    ) {
      const el = e.currentTarget as HTMLTextAreaElement;
      const atFirstLine = !el.value.slice(0, el.selectionStart).includes("\n");
      const atLastLine = !el.value.slice(el.selectionEnd).includes("\n");
      const dir = e.key === "ArrowUp" ? -1 : 1;
      if ((e.key === "ArrowUp" ? atFirstLine : atLastLine)) {
        if (props.onNavigate(b.uuid, dir)) {
          e.preventDefault();
          void save();
          return;
        }
      }
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
        onMenu={(pos) => setMenu(pos)}
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
