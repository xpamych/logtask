import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { IconArrowDown, IconArrowUp, IconMinus } from "~/components/icons";

export const STATUS_COLORS: Record<string, string> = {
  LATER: "#888888",
  TODO: "#09bec8",
  DOING: "#ff9800",
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
const PRIO_ICONS: Record<
  string,
  (p: { size?: number; strokeWidth?: number }) => JSX.Element
> = {
  A: IconArrowUp,
  B: IconMinus,
  C: IconArrowDown,
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
  settings?: Settings | null;
  onStatus?: (marker: string) => void;
  onPriority?: (prio: string | null) => void;
}): JSX.Element {
  const [popup, setPopup] = createSignal(false);

  // подпись статуса: из настроек пользователя, иначе дефолт
  const statusLabel = (marker: string): string =>
    props.settings?.statuses.find((s) => s.marker === marker)?.label ??
    MARKER_LABELS[marker] ??
    marker;

  return (
    <>
      <span
        class="status-prio-dot clickable"
        classList={{
          empty: !props.status,
          [`prio-${(props.priority?.[2] ?? "").toLowerCase()}`]:
            !props.status && !!props.priority,
        }}
        style={{
          background: props.status
            ? (STATUS_COLORS[props.status] ?? "#888888")
            : "transparent",
          // иконка приоритета — контрастная к фону кружка
          color: props.status
            ? contrastOn(STATUS_COLORS[props.status] ?? "#888888")
            : undefined,
        }}
        title={
          (props.status ? statusLabel(props.status) : "Без статуса") +
          (props.priority
            ? `, приоритет ${PRIO_LABELS[props.priority[2]] ?? props.priority}`
            : "") +
          " — клик: изменить"
        }
        onClick={(e) => {
          e.stopPropagation();
          setPopup((v) => !v);
        }}
      >
        {(() => {
          const letter = props.priority?.[2];
          const Icon = letter ? PRIO_ICONS[letter] : undefined;
          if (!letter) return "";
          return Icon ? <Icon size={11} strokeWidth={3.2} /> : letter;
        })()}
      </span>
      <Show when={popup()}>
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
                <span
                  class="status-dot"
                  style={{ background: STATUS_COLORS[m] ?? "#888888" }}
                />
                {statusLabel(m)}
              </button>
            )}
          </For>
          <div class="block-menu-title">Приоритет</div>
          <For each={PRIORITIES}>
            {(p) => (
              <button
                class="block-menu-item"
                classList={{ active: props.priority === `[#${p}]` }}
                onClick={() => {
                  setPopup(false);
                  props.onPriority?.(p);
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
          <Show when={props.priority}>
            <button
              class="block-menu-item"
              onClick={() => {
                setPopup(false);
                props.onPriority?.(null);
              }}
            >
              убрать приоритет
            </button>
          </Show>
        </div>
      </Show>
    </>
  );
}
