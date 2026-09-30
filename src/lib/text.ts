/** Разбирает текст блока на сегменты: [[ссылки]], #теги, обычный текст */

export interface TextSegment {
  type: "text" | "link" | "tag";
  text: string;
  target?: string;
}

const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const TAG_RE = /#(\[[^\]]+\]|[^\s#\[)\]]+)/g;

export function parseSegments(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  type Mark = { start: number; end: number; target: string; label: string; kind: "link" | "tag" };
  const marks: Mark[] = [];

  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(input)) !== null) {
    marks.push({
      start: m.index,
      end: m.index + m[0].length,
      target: m[1].trim(),
      label: (m[2] ?? m[1]).trim(),
      kind: "link",
    });
  }
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(input)) !== null) {
    let target = m[1];
    if (target.startsWith("[[") && target.endsWith("]]")) {
      target = target.slice(2, -2);
    }
    marks.push({
      start: m.index,
      end: m.index + m[0].length,
      target: target.trim(),
      label: m[0],
      kind: "tag",
    });
  }

  marks.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const mark of marks) {
    if (mark.start < pos) continue; // пересекающиеся — пропускаем
    if (mark.start > pos) {
      segments.push({ type: "text", text: input.slice(pos, mark.start) });
    }
    segments.push({
      type: mark.kind,
      text: mark.label,
      target: mark.target,
    });
    pos = mark.end;
  }
  if (pos < input.length) {
    segments.push({ type: "text", text: input.slice(pos) });
  }
  return segments;
}

/** Имя журнала "2026_09_11" → человекочитаемая дата */
export function formatJournalName(name: string): string {
  const match = /^(\d{4})_(\d{2})_(\d{2})$/.exec(name);
  if (!match) return name;
  const [, y, mo, d] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return name;
  const months = [
    "янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
  ];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(date);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  const rel = days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} дн. назад`;
  return `${date.getDate()} ${months[date.getMonth()]} ${y} · ${rel}`;
}
