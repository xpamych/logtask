import { For, Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
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

  // прижимает меню к границам окна, чтобы не вылезало за экран
  onMount(() => {
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
          const cur = () => (key === "urgency" ? props.urgency : props.importance);
          return (
            <button
              class="block-menu-item"
              classList={{ active: cur() === l }}
              onClick={() => {
                props.onClose();
                // повторное нажатие на активный уровень — снимает его
                props.onLevel(key, cur() === l ? null : l);
              }}
            >
              <span class="status-dot" style={{ background: levelColor(l) }} />
              {LEVEL_LABELS[l]}
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
              classList={{ active: props.status === m }}
              onClick={() => {
                props.onClose();
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
                classList={{ active: props.priority === `[#${p}]` }}
                onClick={() => {
                  props.onClose();
                  // повторное нажатие на активный приоритет — снимает его
                  props.onPriority(props.priority === `[#${p}]` ? null : p);
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
                  classList={{ active: props.clockRunning }}
                  onClick={() => {
                    props.onClose();
                    onClock()();
                  }}
                >
                  {props.clockRunning ? "Остановить таймер" : "Начать учёт времени"}
                </button>
              </>
            )}
          </Show>

          <div class="block-menu-title">Прочее</div>
          <button
            class="block-menu-item"
            onClick={() => {
              props.onClose();
              props.onDeadline();
            }}
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
