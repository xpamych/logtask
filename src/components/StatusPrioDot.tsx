import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { IconArrowDown, IconArrowUp, IconMinus } from "~/components/icons";

export const STATUS_COLORS: Record<string, string> = {
  LATER: "#888888",
  TODO: "#09bec8",
  DOING: "#2196f3",
  REVIEW: "#9b59b6",
  DONE: "#4caf50",
  CANCELED: "#f44336",
};

export const MARKERS = ["TODO", "DOING", "LATER", "REVIEW", "DONE", "CANCELED"];
export const MARKER_LABELS: Record<string, string> = {
  LATER: "Бэклог",
  TODO: "К выполнению",
  DOING: "В работе",
  REVIEW: "На проверке",
  DONE: "Выполнено",
  CANCELED: "Отменено",
};
export const PRIORITIES = ["A", "B", "C"];
/// значки приоритета: A — стрелка вверх (красная), B — тире (зелёное),
/// C — стрелка вниз (серая)
export const PRIO_ICONS: Record<
  string,
  (p: { size?: number; strokeWidth?: number }) => JSX.Element
> = {
  A: IconArrowUp,
  B: IconMinus,
  C: IconArrowDown,
};

/// цвета уровней срочности/важности
export function levelColor(level: string | null | undefined): string {
  switch (level) {
    case "high":
      return "var(--danger)";
    case "medium":
      return "var(--warning)";
    case "low":
      return "var(--fg-muted)";
    default:
      return "transparent";
  }
}
export const LEVEL_LABELS: Record<string, string> = {
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};
export const PRIO_LABELS: Record<string, string> = {
  A: "высокий",
  B: "средний",
  C: "низкий",
};

/** Контрастный цвет иконки на цветном кружке статуса:
 *  светлый фон (бирюза/зелёный/оранжевый) — тёмная иконка, тёмный — белая */
function contrastOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "rgba(0,0,0,0.65)" : "#fff";
}

/** Кружок блока/задачи: цвет — статус, внутри — значок приоритета.
 *  Клик открывает общий мини-попап со списками статусов и приоритетов.
 *  Родитель с position: relative обязателен (попап абсолютный). */
export function StatusPrioDot(props: {
  status: string | null;
  priority: string | null;
  /** срочность/важность — кольцо вокруг кружка: левая половина — срочность,
   *  правая — важность (цвета levelColor) */
  urgency?: string | null;
  importance?: string | null;
  settings?: Settings | null;
  onStatus?: (marker: string) => void;
  onPriority?: (prio: string | null) => void;
  /** если задан — клик по кружку открывает внешнее (полное) меню в этой позиции,
   *  встроенный мини-попап не показывается */
  onMenu?: (pos: { x: number; y: number }) => void;
}): JSX.Element {
  const [popup, setPopup] = createSignal(false);

  // подпись статуса: из настроек пользователя, иначе дефолт
  const statusLabel = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ??
    MARKER_LABELS[marker] ??
    marker;

  // цвет статуса: из настроек пользователя, иначе дефолт
  const statusColor = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.color ??
    STATUS_COLORS[marker] ??
    "#888888";

  // кольцо срочности/важности вокруг кружка (null — без кольца)
  const ringColors = () =>
    props.urgency || props.importance
      ? { "--u": levelColor(props.urgency), "--i": levelColor(props.importance) }
      : null;

  const dot = (
    <span
      class="status-prio-dot clickable"
      classList={{
        empty: !props.status,
        [`prio-${(props.priority?.[2] ?? "").toLowerCase()}`]:
          !props.status && !!props.priority,
      }}
      style={{
        background: props.status ? statusColor(props.status) : "transparent",
        // иконка приоритета — контрастная к фону кружка
        color: props.status ? contrastOn(statusColor(props.status)) : undefined,
      }}
      title={
        (props.status ? statusLabel(props.status) : "Без статуса") +
        (props.priority
          ? `, приоритет ${PRIO_LABELS[props.priority[2]] ?? props.priority}`
          : "") +
        (props.urgency ? `, срочность ${LEVEL_LABELS[props.urgency] ?? props.urgency}` : "") +
        (props.importance
          ? `, важность ${LEVEL_LABELS[props.importance] ?? props.importance}`
          : "") +
        " — клик: изменить"
      }
      onClick={(e) => {
        e.stopPropagation();
        if (props.onMenu) {
          props.onMenu({ x: e.clientX, y: e.clientY });
        } else {
          setPopup((v) => !v);
        }
      }}
    >
      {(() => {
        const letter = props.priority?.[2];
        const Icon = letter ? PRIO_ICONS[letter] : undefined;
        if (!letter) return "";
        return Icon ? <Icon size={11} strokeWidth={3.2} /> : letter;
      })()}
    </span>
  );

  return (
    <>
      <Show when={ringColors()} fallback={dot}>
        {(r) => (
          <span
            class="status-prio-ring"
            style={{ "--u": r()["--u"], "--i": r()["--i"] }}
          >
            {dot}
          </span>
        )}
      </Show>
      <Show when={popup()}>
        <div
          class="menu-backdrop"
          onClick={() => setPopup(false)}
          onContextMenu={(e) => {
            e.preventDefault();
            setPopup(false);
          }}
        />
        <div class="mini-popup" onClick={(e) => e.stopPropagation()}>
          <div class="block-menu-title">Статус</div>
          <For each={MARKERS}>
            {(m) => (
              <button
                class="block-menu-item"
                classList={{ active: props.status === m }}
                onClick={() => {
                  setPopup(false);
                  props.onStatus?.(m);
                }}
              >
                <span class="status-dot" style={{ background: statusColor(m) }} />
                {statusLabel(m)}
              </button>
            )}
          </For>
          <div class="block-menu-title">Приоритет</div>
          <For each={[...PRIORITIES].reverse()}>
            {(p) => (
              <button
                class="block-menu-item"
                classList={{ active: props.priority === `[#${p}]` }}
                onClick={() => {
                  setPopup(false);
                  // повторное нажатие на активный приоритет — снимает его
                  props.onPriority?.(props.priority === `[#${p}]` ? null : p);
                }}
              >
                <span class={`prio-icon prio-${p.toLowerCase()}`}>
                  {(() => {
                    const Icon = PRIO_ICONS[p];
                    return Icon ? <Icon size={13} strokeWidth={2.6} /> : p;
                  })()}
                </span>
                {PRIO_LABELS[p]}
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
