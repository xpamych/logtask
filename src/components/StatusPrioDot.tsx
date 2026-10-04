import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";

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
export const PRIO_ICONS: Record<string, string> = { A: "↑", B: "–", C: "↓" };
export const PRIO_LABELS: Record<string, string> = {
  A: "высокий",
  B: "средний",
  C: "низкий",
};

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
        {props.priority
          ? (PRIO_ICONS[props.priority[2]] ?? props.priority[2])
          : ""}
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
                  {PRIO_ICONS[p]}
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
