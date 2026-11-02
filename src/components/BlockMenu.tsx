import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { trackOpenBlockMenu } from "~/lib/editState";
import { activeModalContext, pushModalContext } from "~/lib/modalState";
import { commandForContext, effectiveShortcuts, formatShortcut, normalizeShortcut, shouldHandleGlobalShortcut } from "~/lib/shortcuts";
import {
  MARKERS,
  MARKER_LABELS,
  PRIORITIES,
  PRIO_ICONS,
  STATUS_COLORS,
  levelColor,
  LEVEL_LABELS,
} from "./StatusPrioDot";

const LEVELS = ["low", "medium", "high"];

/**
 * Общее контекстное меню блока: используется и в карточках задач
 * (подборки/канбан/матрица), и в блоках журнала/страницы — один элемент,
 * меняется везде одновременно. Открывается в точке клика и прижимается
 * к границам окна; закрывается кликом (любой кнопкой) вне меню.
 *
 * Для обычных блоков (task=false) видны только «Удалить блок»
 * и выбор статуса (перевод в задачу); секции задачи скрыты.
 */
export function BlockMenu(props: {
  pos: { x: number; y: number };
  onClose: () => void;
  status: string | null;
  priority: string | null;
  urgency: string | null;
  importance: string | null;
  /** блок — задача: показать приоритет/срочность/важность/дедлайн/часы */
  task: boolean;
  clockRunning?: boolean;
  settings?: Settings | null;
  onStatus: (marker: string) => void;
  onPriority: (prio: string | null) => void;
  onLevel: (key: "urgency" | "importance", level: string | null) => void;
  onDeadline: () => void;
  onDelete: () => void;
  onClockToggle?: () => void;
}): JSX.Element {
  let menuEl: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal(props.pos);
  const [status, setStatus] = createSignal(props.status);
  const [priority, setPriority] = createSignal(props.priority);
  const [urgency, setUrgency] = createSignal(props.urgency);
  const [importance, setImportance] = createSignal(props.importance);
  const [clockRunning, setClockRunning] = createSignal(props.clockRunning);

  // прижимает меню к границам окна, чтобы не вылезало за экран
  onMount(() => {
    const closeContext = pushModalContext("taskMenu");
    onCleanup(closeContext);
    onCleanup(trackOpenBlockMenu());
    const el = menuEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let { x, y } = pos();
    if (r.right > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - r.width - pad);
    }
    if (r.bottom > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - r.height - pad);
    }
    if (x !== pos().x || y !== pos().y) setPos({ x, y });
  });

  const levelCommand = (key: "urgency" | "importance", level: string) =>
    `${key}${level[0].toUpperCase()}${level.slice(1)}`;
  const levelShortcut = (key: "urgency" | "importance", level: string) =>
    formatShortcut(
      effectiveShortcuts(props.settings?.shortcuts ?? {})[levelCommand(key, level)],
      navigator.platform.includes("Mac"),
    );

  onMount(() => {
    const isMac = navigator.platform.includes("Mac");
    const onKeyDown = (e: KeyboardEvent) => {
      if (!props.task || e.isComposing || activeModalContext() !== "taskMenu") return;
      const shortcut = normalizeShortcut(e, isMac);
      if (!shortcut || !shouldHandleGlobalShortcut(e.target, shortcut)) return;
      const effective = effectiveShortcuts(props.settings?.shortcuts ?? {});
      const id = commandForContext(shortcut, effective, "taskMenu");
      for (const key of ["urgency", "importance"] as const) {
        for (const level of LEVELS) {
          if (id !== levelCommand(key, level)) continue;
          e.preventDefault();
          const current = key === "urgency" ? urgency() : importance();
          const next = current === level ? null : level;
          if (key === "urgency") setUrgency(next);
          else setImportance(next);
          props.onLevel(key, next);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const statusLabel = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ??
    MARKER_LABELS[marker] ??
    marker;

  const statusColor = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.color ??
    STATUS_COLORS[marker] ??
    "#888888";

  const levelRow = (key: "urgency" | "importance", title: string) => (
    <>
      <div class="block-menu-title">{title}</div>
      <For each={LEVELS}>
        {(l) => {
          const cur = () => (key === "urgency" ? urgency() : importance());
          return (
            <button
              class="block-menu-item"
              classList={{ active: cur() === l }}
              onClick={() => {
                // повторное нажатие на активный уровень — снимает его
                const next = cur() === l ? null : l;
                if (key === "urgency") setUrgency(next);
                else setImportance(next);
                props.onLevel(key, next);
              }}
            >
              <span class="status-dot" style={{ background: levelColor(l) }} />
              {LEVEL_LABELS[l]}
              <kbd class="block-menu-shortcut">{levelShortcut(key, l)}</kbd>
            </button>
          );
        }}
      </For>
    </>
  );

  return (
    <>
      <div
        class="menu-backdrop"
        onClick={() => props.onClose()}
        onContextMenu={(e) => {
          e.preventDefault();
          props.onClose();
        }}
      />
      <div
        ref={menuEl}
        class="block-menu ctx-menu"
        style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="block-menu-title">Статус</div>
        <For each={MARKERS}>
          {(m) => (
            <button
              class="block-menu-item"
              classList={{ active: status() === m }}
              onClick={() => {
                setStatus(m);
                props.onStatus(m);
              }}
            >
              <span class="status-dot" style={{ background: statusColor(m) }} />
              {statusLabel(m)}
            </button>
          )}
        </For>

        <Show when={props.task}>
          <div class="block-menu-title">Приоритет</div>
          <For each={[...PRIORITIES].reverse()}>
            {(p) => (
              <button
                class="block-menu-item"
                classList={{ active: priority() === `[#${p}]` }}
                onClick={() => {
                  // повторное нажатие на активный приоритет — снимает его
                  const next = priority() === `[#${p}]` ? null : p;
                  setPriority(next === null ? null : `[#${next}]`);
                  props.onPriority(next);
                }}
              >
                <span class={`prio-icon prio-${p.toLowerCase()}`}>
                  {(() => {
                    const Icon = PRIO_ICONS[p];
                    return Icon ? <Icon size={12} strokeWidth={2.6} /> : p;
                  })()}
                </span>
                {p === "A" ? "высокий" : p === "B" ? "средний" : "низкий"}
              </button>
            )}
          </For>
          {levelRow("urgency", "Срочность")}
          {levelRow("importance", "Важность")}

          <Show when={props.onClockToggle}>
            {(onClock) => (
              <>
                <div class="block-menu-title">Учёт времени</div>
                <button
                  class="block-menu-item"
                  classList={{ active: clockRunning() }}
                  onClick={() => {
                    setClockRunning(!clockRunning());
                    onClock()();
                  }}
                >
                  {clockRunning() ? "Остановить таймер" : "Начать учёт времени"}
                </button>
              </>
            )}
          </Show>

          <div class="block-menu-title">Прочее</div>
          <button
            class="block-menu-item"
            onClick={() => props.onDeadline()}
          >
            Дедлайн…
          </button>
        </Show>

        <button
          class="block-menu-item danger"
          onClick={() => {
            props.onClose();
            props.onDelete();
          }}
        >
          Удалить блок
        </button>
      </div>
    </>
  );
}
