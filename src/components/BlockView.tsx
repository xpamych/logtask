import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { editingBlock, pendingEdit, setEditingBlock, setPendingEdit } from "~/lib/editState";
import { clickCaretPosition, editorSource, persistedSource, renderSourceMap } from "~/lib/text";
import { pasteImage, waitForImagePaste } from "~/lib/pasteImage";
import type { TextInputAdapter } from "~/lib/pasteImage";
import type { EditorView } from "@codemirror/view";
import { BlockEditor } from "./editor/BlockEditor";
import { canSaveBlock } from "./editor/editorCommands";
import { enterCreatesChild } from "~/lib/blockTree";
import { RichText } from "./RichText";
import { BlockMenu } from "./BlockMenu";
import { StatusPrioDot } from "./StatusPrioDot";
import { Autocomplete, createAutocomplete } from "./Autocomplete";
import type { BlockDto, Settings } from "~/lib/api";
import {
  assetSave,
  clipboardAssetSave,
  blockIndent,
  blockMergeDown,
  blockMergeUp,
  blockOutdent,
  blockRefCreate,
  blockSetProp,
  blockSplit,
  blockUpdateText,
  clockStart,
  clockStop,
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
  firstBlock?: boolean;
  onOpenPage?: (name: string) => void;
  onChanged?: () => void;
  onStatusChange?: (uuid: string, marker: string) => Promise<string>;
  onDelete?: (uuid: string) => void | Promise<void>;
  /** переход кареткой на соседний блок (стрелки в редакторе);
   *  возвращает false, если соседа нет */
  onNavigate?: (uuid: string, dir: -1 | 1) => boolean;
  settings?: Settings | null;
  onSelectAll?: () => void;
  onCancelEdit?: (uuid: string) => void;
  selected?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleFold?: () => void;
  onSelect?: (uuid: string, extend: boolean) => void;
  onBeginEdit?: () => void;
}): JSX.Element {
  const [b, setB] = createStore<BlockDto>(props.block);
  const onOpen = props.onOpenPage;

  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [editAnchor, setEditAnchor] = createSignal(0);
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = createSignal(false);
  let editorView: EditorView | undefined;
  const inputAdapter: TextInputAdapter = {
    get value() { return editorView?.state.doc.toString() ?? draft(); },
    get selectionStart() { return editorView?.state.selection.main.from ?? 0; },
    get selectionEnd() { return editorView?.state.selection.main.to ?? 0; },
  };
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  const [pasteBusy, setPasteBusy] = createSignal(false);
  const autocomplete = createAutocomplete(
    ({ text, caret }) => {
      setDraft(text);
      queueMicrotask(() => {
        if (!editorView) return;
        editorView.focus();
        editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text }, selection: { anchor: caret } });
      });
    },
    setPasteError,
  );

  const onImagePaste = async (e: ClipboardEvent) => {
    if (!editorView) return;
    setPasteError(null);
    setPasteBusy(true);
    const result = await pasteImage(e, inputAdapter, assetSave, clipboardAssetSave);
    setPasteBusy(false);
    if (result.error) {
      setPasteError(result.error);
      return;
    }
    if (result.text !== undefined && result.caret !== undefined) {
      setDraft(result.text);
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: result.text! }, selection: { anchor: result.caret! } });
    }
  };

  const startEdit = (event?: MouseEvent) => {
    props.onBeginEdit?.();
    let anchor = 0;
    if (event) {
      const container = event.currentTarget as HTMLElement;
      const selection = window.getSelection();
      if (selection?.anchorNode && container.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(container);
        range.setEnd(selection.anchorNode, selection.anchorOffset);
        const visibleOffset = range.toString().length;
        const labels = Object.fromEntries(
          Array.from(container.querySelectorAll<HTMLElement>(".block-ref[data-uuid]"))
            .map((element) => [element.dataset.uuid!, element.textContent ?? ""]),
        );
        const mapped = renderSourceMap(b.content, labels)[Math.min(visibleOffset, renderSourceMap(b.content, labels).length - 1)] ?? 0;
        anchor = clickCaretPosition(mapped, visibleOffset, container.textContent?.length ?? 0, editorSource(b.source).length);
      }
    }
    setEditAnchor(anchor);
    setDraft(editorSource(b.source));
    setEditing(true);
    setEditingBlock(b.uuid);
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
          void moveIndent(true, editorView?.state.selection.main.from ?? 0, editorView?.state.doc.toString() ?? draft());
        });
      } catch {
        /* вне Tauri */
      }
    })();
    onCleanup(() => unlisten?.());
  });

  const save = async (currentText?: string) => {
    if (!canSaveBlock({ saving: saving(), editing: editing() })) return;
    if (editorView) await waitForImagePaste(inputAdapter);
    const text = (currentText ?? editorView?.state.doc.toString() ?? draft()).trim();
    if (!text || text === editorSource(b.source).trim()) {
      stopEdit();
      return;
    }
    setSaving(true);
    try {
      await blockUpdateText(b.uuid, persistedSource(text));
      stopEdit();
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка сохранения:", e);
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (editorView) await waitForImagePaste(inputAdapter);
    stopEdit();
    setDraft(editorSource(b.source));
    props.onCancelEdit?.(b.uuid);
  };

  // вход в редактирование по сигналу через pendingEdit: продолжение после
  // склейки/разбиения (страница перезагрузилась, это выживший блок) или
  // навигация стрелками от соседнего блока (тот уже смонтирован — поэтому
  // эффект, а не разовая проверка в теле компонента)
  createEffect(() => {
    const pending = pendingEdit();
    if (!pending || pending.uuid !== b.uuid || editing()) return;
    setPendingEdit(null);
    const lines = editorSource(b.source).split("\n");
    let pos: number;
    if (pending.atLine !== undefined || pending.minusLines !== undefined) {
      const idx = pending.atLine ?? lines.length - (pending.minusLines ?? 0);
      const clamped = Math.min(Math.max(0, idx), lines.length - 1);
      pos = lines.slice(0, clamped).reduce((s, l) => s + l.length + 1, 0);
    } else {
      pos = Math.min(pending.at ?? 0, editorSource(b.source).length);
    }
    startEdit();
    setEditAnchor(pos);
  });

  /// Backspace в самом начале блока: склеивание с вышестоящим (как в Logseq).
  /// Редактирование продолжается уже в склеенном блоке (новый uuid),
  /// курсор — в точке стыка
  const mergeUp = async () => {
    // строки черновика: первая станет отдельной строкой после вышестоящего
    // блока, за ней — trailing; стык = начало строки «curLines-я с конца»
    const curLines = draft().split("\n").length;
    try {
      const res = await blockMergeUp(b.uuid, persistedSource(draft()));
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
      const res = await blockMergeDown(b.uuid, persistedSource(draft()));
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
  const moveIndent = async (out: boolean, at: number, currentText: string) => {
    setSaving(true);
    stopEdit();
    try {
      const source = persistedSource(currentText);
      const res = out ? await blockOutdent(b.uuid, source) : await blockIndent(b.uuid, source);
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, at });
        props.onChanged?.();
      } else {
        setDraft(currentText);
        setEditing(true);
        setEditingBlock(b.uuid);
      }
    } catch (e) {
      setDraft(currentText);
      setEditing(true);
      setEditingBlock(b.uuid);
      console.error("смена вложенности:", e);
    } finally {
      setSaving(false);
    }
  };

  /// Enter в редакторе (как в Logseq): текущий черновик делится по курсору —
  /// текст до курсора остаётся в блоке, текст после уходит в новый блок ниже;
  /// редактирование продолжается уже в новом блоке (курсор в начале)
  const splitBlock = async (currentText: string, start: number, end: number) => {
    const text = currentText;
    const before = persistedSource(text.slice(0, start));
    const after = persistedSource(text.slice(end));
    setSaving(true);
    stopEdit();
    try {
      const res = await blockSplit(b.uuid, before, after, enterCreatesChild(props.hasChildren ?? false, props.collapsed ?? false));
      if (res) {
        setEditingBlock(res.uuid);
        setPendingEdit({ uuid: res.uuid, at: 0 });
        props.onChanged?.();
      }
    } catch (e) {
      setDraft(text);
      setEditing(true);
      setEditingBlock(b.uuid);
      console.error("разбиение блока:", e);
    } finally {
      setSaving(false);
    }
  };

  const onStatus = async (marker: string) => {
    const freshUuid = await props.onStatusChange?.(b.uuid, marker);
    if (freshUuid) setB("uuid", freshUuid);
    setB("status", marker);
  };

  const onClockToggle = async () => {
    const running = !b.clockRunning;
    try {
      const freshUuid = b.clockRunning
        ? await clockStop(b.uuid)
        : await clockStart(b.uuid);
      setB("uuid", freshUuid);
      setB("clockRunning", running);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка CLOCK:", e);
    }
  };

  const onPriority = async (prio: string | null) => {
    try {
      const freshUuid = await taskSetPriority(b.uuid, prio);
      setB("uuid", freshUuid);
      setB("priority", prio === null ? null : `[#${prio}]`);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка приоритета:", e);
    }
  };

  const onLevel = async (key: "urgency" | "importance", level: string | null) => {
    try {
      const freshUuid = await taskSetQuadrant(
        b.uuid,
        key === "urgency" ? level : null,
        key === "importance" ? level : null,
      );
      setB("uuid", freshUuid);
      setB(key, level);
      props.onChanged?.();
    } catch (e) {
      console.error("ошибка уровня:", e);
    }
  };

  const onDeadline = async () => {
    const value = window.prompt(
      "Дедлайн (YYYY-MM-DD):",
      b.deadline ?? "",
    );
    if (value === null) return;
    const deadline = value.trim() || null;
    try {
      const freshUuid = await blockSetProp(b.uuid, "deadline", deadline);
      setB("uuid", freshUuid);
      setB("deadline", deadline);
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

  const onCopyRef = async () => {
    try {
      const result = await blockRefCreate(b.uuid);
      await navigator.clipboard.writeText(result.ref);
      setB("uuid", result.uuid);
      setMenu(null);
      props.onChanged?.();
    } catch (error) {
      setPasteError(`Не удалось скопировать ссылку: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div
      class="block"
      classList={{ "block-task": b.task, "block-selected": props.selected ?? false }}
      data-uuid={b.uuid || undefined}
      data-indent={b.indent}
      style={{ "padding-left": `${10 + b.indent * 22}px` }}
      tabindex={-1}
      onKeyDown={onBlockKeyDown}
      onContextMenu={onContextMenu}
    >
      <Show when={b.indent > 0}>
        <svg class="block-tree-link" width="28" height="46" viewBox="0 0 28 46" fill="none" aria-hidden="true">
          <path d="M2 0 V27 Q2 39 14 39 H17" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </Show>
      <span class="block-fold-slot">
        <Show when={props.hasChildren}>
          <button
            type="button"
            class="block-fold print-hidden"
            aria-label={props.collapsed ? "Развернуть вложенные блоки" : "Свернуть вложенные блоки"}
            aria-expanded={!props.collapsed}
            onClick={(event) => { event.stopPropagation(); props.onToggleFold?.(); }}
          ><svg class="block-fold-icon" classList={{ collapsed: props.collapsed ?? false }} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
        </Show>
      </span>
      <StatusPrioDot
        status={b.status}
        priority={b.priority}
        urgency={b.urgency}
        importance={b.importance}
        settings={props.settings}
        onStatus={(m) => void onStatus(m)}
        onPriority={(p) => void onPriority(p)}
        onMenu={(pos) => setMenu(pos)}
      />
      <div class="block-content">
        <Show
          when={editing()}
          fallback={
            <span class="block-text" onClick={(event) => {
              if (event.shiftKey) props.onSelect?.(b.uuid, true);
              else startEdit(event);
            }}>
              <RichText text={b.content} onOpenPage={onOpen} />
              <Show when={b.extra.length > 0}>
                <span class="block-extra">
                  <RichText text={b.extra.join("\n")} onOpenPage={onOpen} />
                </span>
              </Show>
            </span>
          }
        >
          <BlockEditor
            ref={(view) => { editorView = view ?? undefined; }}
            initialValue={draft()}
            initialAnchor={editAnchor()}
            mode={props.settings?.editorMode ?? "live"}
            onDraft={(text) => {
              setDraft(text);
              void autocomplete.onInput(text, editorView?.state.selection.main.from ?? 0);
            }}
            onSave={(text) => void save(text)}
            onCancel={() => void cancel()}
            onSplit={(text, start, end) => void splitBlock(text, start, end)}
            onIndent={(out, at, text) => void moveIndent(out, at, text)}
            onMerge={(direction) => {
              if (direction < 0) {
                if (!props.firstBlock) void mergeUp();
              } else void mergeDown();
            }}
            onNavigate={(direction) => {
              if (props.onNavigate?.(b.uuid, direction)) {
                void save();
                return true;
              }
              return false;
            }}
            onSelectAll={() => props.onSelectAll?.()}
            onPaste={(event) => void onImagePaste(event)}
            onKeyDown={(event) => {
              if (!autocomplete.open || !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return false;
              event.preventDefault();
              void autocomplete.onKeyDown(event);
              return true;
            }}
          />
          <Show when={pasteBusy()}><div class="muted">Сохранение изображения…</div></Show>
          <Show when={pasteError()}>{(message) => <div class="error">{message()}</div>}</Show>
          <Show when={autocomplete.open}>
            <Autocomplete
              id={`block-autocomplete-${b.uuid}`}
              items={autocomplete.items}
              activeIndex={autocomplete.activeIndex}
              onAccept={(item) => void autocomplete.accept(item)}
            />
          </Show>
        </Show>
        <Show when={!editing() && pasteError()}>
          {(message) => <div class="error">{message()}</div>}
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
            onStatus={(m) => void onStatus(m)}
            onPriority={(p) => void onPriority(p)}
            onLevel={(k, l) => void onLevel(k, l)}
            onDeadline={() => void onDeadline()}
            onDelete={onDeleteBlock}
            onCopyRef={() => void onCopyRef()}
            onClockToggle={b.task ? () => void onClockToggle() : undefined}
          />
        )}
      </Show>
    </div>
  );
}
