export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  available: boolean;
  today: boolean;
}

export interface MonthId {
  year: number;
  month: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function shiftMonth(year: number, month: number, delta: number): MonthId {
  const index = year * 12 + month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}

export function monthGrid(
  year: number,
  month: number,
  weekStart: 0 | 1,
  available: ReadonlySet<string> = new Set(),
  today = "",
): CalendarDay[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, index - offset + 1));
    const name = `${date.getUTCFullYear()}_${pad(date.getUTCMonth() + 1)}_${pad(date.getUTCDate())}`;
    return {
      date: name,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
      available: available.has(name),
      today: name === today,
    };
  });
}
