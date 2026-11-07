import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { journalList } from "~/lib/api";
import { monthGrid, shiftMonth } from "~/lib/calendar";
import type { MonthId } from "~/lib/calendar";
import { todayJournalName } from "~/lib/text";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function MiniCalendar(props: {
  weekStart: 0 | 1;
  refreshKey: number;
  onSelect: (name: string) => void;
}): JSX.Element {
  const [current, setCurrent] = createSignal(todayJournalName());
  const timer = window.setInterval(() => setCurrent(todayJournalName()), 60_000);
  let listEpoch = 0;
  onCleanup(() => {
    window.clearInterval(timer);
    listEpoch += 1;
  });
  const [month, setMonth] = createSignal<MonthId>({
    year: Number(current().slice(0, 4)),
    month: Number(current().slice(5, 7)),
  });
  const [available, setAvailable] = createSignal<Set<string>>(new Set());
  const [selected, setSelected] = createSignal(current());

  createEffect(async () => {
    void props.refreshKey;
    const my = ++listEpoch;
    try {
      const journals = await journalList();
      if (my === listEpoch) setAvailable(new Set<string>(journals));
    } catch {
      if (my === listEpoch) setAvailable(new Set<string>());
    }
  });

  const days = () => monthGrid(month().year, month().month, props.weekStart, available(), current());
  const title = () =>
    new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(month().year, month().month - 1, 1)),
    );
  const weekdayNames = () =>
    props.weekStart === 0 ? ["Вс", ...WEEKDAYS.slice(0, 6)] : WEEKDAYS;

  const move = (delta: number) => {
    setMonth((value) => shiftMonth(value.year, value.month, delta));
  };
  const goToday = () => {
    const today = todayJournalName();
    setCurrent(today);
    setMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
    select(today);
  };
  const select = (name: string) => {
    if (!available().has(name)) return;
    setSelected(name);
    props.onSelect(name);
  };
  const moveFocus = (date: string, delta: number, edge?: "first" | "last") => {
    const grid = days();
    const index = grid.findIndex((day) => day.date === date);
    const next = edge === "first" ? grid[0] : edge === "last" ? grid[grid.length - 1] : grid[index + delta];
    if (next?.available) {
      document.querySelector<HTMLButtonElement>(`[data-calendar-day="${next.date}"]`)?.focus();
    }
  };
  const accessibleDate = (date: string) => {
    const [year, month, day] = date.split("_").map(Number);
    return `${day}.${month}.${year}`;
  };

  return (
    <section class="mini-calendar" aria-label="Календарь журнала">
      <div class="mini-calendar-header">
        <button type="button" title="Предыдущий месяц" aria-label="Предыдущий месяц" onClick={() => move(-1)}>‹</button>
        <button type="button" class="mini-calendar-title" onClick={goToday}>{title()}</button>
        <button type="button" title="Следующий месяц" aria-label="Следующий месяц" onClick={() => move(1)}>›</button>
      </div>
      <div class="mini-calendar-weekdays">
        <For each={weekdayNames()}>{(day) => <span>{day}</span>}</For>
      </div>
      <div class="mini-calendar-grid">
        <For each={days()}>
          {(day) => (
            <button
              type="button"
              data-calendar-day={day.date}
              class="mini-calendar-day"
              classList={{ muted: !day.inMonth, available: day.available, selected: selected() === day.date, today: day.today }}
              disabled={!day.available}
              aria-pressed={selected() === day.date}
              aria-current={day.today ? "date" : undefined}
              aria-label={`${accessibleDate(day.date)}${day.available ? ", есть журнал" : ", нет журнала"}`}
              onClick={() => select(day.date)}
              onKeyDown={(event) => {
                const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                if (event.key in moves) {
                  event.preventDefault();
                  moveFocus(day.date, moves[event.key]);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  moveFocus(day.date, 0, event.key === "Home" ? "first" : "last");
                }
              }}
            >
              {day.day}
            </button>
          )}
        </For>
      </div>
      <Show when={!days().some((day) => day.available)}>
        <div class="mini-calendar-empty">В этом месяце журналов нет</div>
      </Show>
    </section>
  );
}
