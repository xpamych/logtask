/** Разбирает текст блока на сегменты: [[ссылки]], #теги, обычный текст */

export interface TextSegment {
  type: "text" | "link" | "tag";
  text: string;
  target?: string;
}

const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
// простые теги обрываются по той же пунктуации, что и в ядре
// (src-tauri/src/core/parser.rs, extract_links)
const TAG_RE = /#(\[\[[^\]]+\]\]|\[[^\]]+\]|[^\s#\[)\],.;:!?("«»]+)/g;

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

/** Имя страницы сегодняшнего дня: "2026_10_04" */
export function todayJournalName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}_${pad(d.getMonth() + 1)}_${pad(d.getDate())}`;
}

/** Имя журнала "2026_09_11" → человекочитаемая дата */export function formatJournalName(name: string): string {
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
  let rel: string;
  if (days === 0) rel = "сегодня";
  else if (days === 1) rel = "вчера";
  else if (days === -1) rel = "завтра";
  else if (days > 1) rel = `${days} дн. назад`;
  else rel = `через ${-days} дн.`;
  return `${date.getDate()} ${months[date.getMonth()]} ${y} · ${rel}`;
}

/** Заголовок-дата, который Logtask пишет первой строкой в новый файл журнала
 *  (как Logseq): "2026_09_30" → "Sep 30th, 2026". Зеркалит journal_title
 *  в src-tauri/src/commands.rs. */
export function journalLogseqTitle(name: string): string {
  const match = /^(\d{4})_(\d{2})_(\d{2})$/.exec(name);
  if (!match) return "";
  const [, y, mo, d] = match;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const day = Number(d);
  let suffix = "th";
  if (day % 10 === 1 && day !== 11) suffix = "st";
  else if (day % 10 === 2 && day !== 12) suffix = "nd";
  else if (day % 10 === 3 && day !== 13) suffix = "rd";
  return `${months[Number(mo) - 1]} ${day}${suffix}, ${y}`;
}

/** Инлайн-сегмент markdown для отображения без разметки */
export interface InlineSegment {
  type:
    | "text"
    | "link"
    | "tag"
    | "bold"
    | "italic"
    | "strike"
    | "code"
    | "highlight"
    | "image"
    | "url";
  text: string;
  target?: string;
  children?: InlineSegment[];
  /** полупрозрачный диапазон [start, end) во входной строке parseInline —
   *  нужен для перевода позиции клика в отрендеренном тексте обратно
   *  в позицию в исходнике */
  start: number;
  end: number;
}

// порядок альтернатив важен: картинки и md-ссылки раньше [[ссылок]],
// голый URL — последним (после md-ссылки)
const INLINE_RE =
  /(!\[\[[^\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\(https?:\/\/[^)]+\))|(\[\[[^\]|]+(?:\|[^\]]*)?\]\])|(#(?:\[\[[^\]]+\]\]|\[[^\]]+\]|[^\s#\[)\],.;:!?("«»]+))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(`[^`]+`)|(\^\^[^^]+\^\^)|(https?:\/\/[^\s)\]]+)/g;

/** Хвостовую пунктуацию голого URL (точка/запятая в конце предложения)
 *  не включаем в ссылку */
export function trimUrlTail(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

/** Разбирает инлайн-markdown: [[ссылки]], #теги, **жирный**, *курсив*,
 *  ~~зачёркнутый~~, `код`, ^^подсветка^^. Вложенность — внутри
 *  bold/italic/strike/highlight (код — литерал). */
export function parseInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let pos = 0;
  // локальный экземпляр: рекурсия (bold/italic/…) не должна сбивать
  // lastIndex общего регэкспа — иначе внешний цикл бесконечен
  const re = new RegExp(INLINE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > pos) {
      segments.push({ type: "text", text: input.slice(pos, m.index), start: pos, end: m.index });
    }
    const start = m.index;
    const end = m.index + m[0].length;
    const [, imgEmbed, imgMd, mdLink, link, tag, bold, italic, strike, code, highlight, bareUrl] = m;
    if (imgEmbed !== undefined) {
      // logseq-вставка: ![[../assets/x.png]]
      const path = imgEmbed.slice(3, -2).trim();
      segments.push({ type: "image", text: path, target: path, start, end });
    } else if (imgMd !== undefined) {
      // markdown-картинка: ![alt](path)
      const inner = /!\[([^\]]*)\]\(([^)]+)\)/.exec(imgMd);
      segments.push({
        type: "image",
        text: inner?.[1] ?? "",
        target: (inner?.[2] ?? "").trim(),
        start,
        end,
      });
    } else if (mdLink !== undefined) {
      // markdown-ссылка: [текст](https://…)
      const inner = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(mdLink);
      segments.push({
        type: "url",
        text: inner?.[1] ?? mdLink,
        target: trimUrlTail((inner?.[2] ?? "").trim()),
        start,
        end,
      });
    } else if (bareUrl !== undefined) {
      // голый URL — кликабельный
      segments.push({
        type: "url",
        text: trimUrlTail(bareUrl),
        target: trimUrlTail(bareUrl),
        start,
        end,
      });
    } else if (link !== undefined) {
      const inner = link.slice(2, -2);
      const pipe = inner.indexOf("|");
      const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const label = (pipe === -1 ? inner : inner.slice(pipe + 1)).trim();
      segments.push({ type: "link", text: label, target, start, end });
    } else if (tag !== undefined) {
      let target = tag.slice(1);
      if (target.startsWith("[[") && target.endsWith("]]")) {
        target = target.slice(2, -2);
      }
      segments.push({ type: "tag", text: tag, target: target.trim(), start, end });
    } else if (bold !== undefined) {
      segments.push({
        type: "bold",
        text: bold,
        children: parseInline(bold.slice(2, -2)),
        start,
        end,
      });
    } else if (italic !== undefined) {
      segments.push({
        type: "italic",
        text: italic,
        children: parseInline(italic.slice(1, -1)),
        start,
        end,
      });
    } else if (strike !== undefined) {
      segments.push({
        type: "strike",
        text: strike,
        children: parseInline(strike.slice(2, -2)),
        start,
        end,
      });
    } else if (code !== undefined) {
      segments.push({ type: "code", text: code.slice(1, -1), start, end });
    } else if (highlight !== undefined) {
      segments.push({
        type: "highlight",
        text: highlight,
        children: parseInline(highlight.slice(2, -2)),
        start,
        end,
      });
    }
    pos = end;
  }
  if (pos < input.length) {
    segments.push({ type: "text", text: input.slice(pos), start: pos, end: input.length });
  }
  return segments;
}

/** Блочная структура текста блока: заголовки (#..######), блоки кода ```
 *  (с языком из ограждения), остальные строки — обычные */
export type MdBlock =
  | { kind: "code"; text: string; lang?: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "line"; text: string };

export function splitMdBlocks(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let inCode = false;
  let codeLang: string | undefined;
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: buf.join("\n"), lang: codeLang });
        buf = [];
        inCode = false;
        codeLang = undefined;
      } else {
        inCode = true;
        codeLang = line.trim().slice(3).trim().split(/\s/)[0] || undefined;
      }
      continue;
    }
    if (inCode) {
      buf.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
    } else {
      blocks.push({ kind: "line", text: line });
    }
  }
  if (buf.length > 0) {
    blocks.push({ kind: "code", text: buf.join("\n"), lang: codeLang });
  }
  return blocks;
}

/** Листовой сегмент с абсолютными диапазонами [start, end) в исходной
 *  строке: bold/italic/strike/highlight развёрнуты (маркеры сняты),
 *  code — без бэктиков. Картинки не дают текста и пропускаются. */
export interface FlatSegment {
  text: string;
  start: number;
  end: number;
}

export function flatInline(input: string): FlatSegment[] {
  const out: FlatSegment[] = [];
  const walk = (segs: InlineSegment[], base: number) => {
    for (const s of segs) {
      switch (s.type) {
        case "bold":
        case "strike":
        case "highlight":
          walk(s.children ?? [], base + s.start + 2);
          break;
        case "italic":
          walk(s.children ?? [], base + s.start + 1);
          break;
        case "code":
          out.push({ text: s.text, start: base + s.start + 1, end: base + s.end - 1 });
          break;
        case "image":
          break;
        default:
          out.push({ text: s.text, start: base + s.start, end: base + s.end });
      }
    }
  };
  walk(parseInline(input), 0);
  return out;
}

/**
 * Карта «позиция каретки в отрендеренном тексте → смещение в исходнике».
 * Повторяет трансформации RichText: trim, ограждения ``` не показываются,
 * у заголовков снимается "# ", инлайн-разметка заменяется видимым текстом.
 * Строки в DOM идут блоками без текстовых разделителей, поэтому в карте
 * их текст конкатенируется; строки внутри код-блоков разделены реальными
 * "\n" (pre), они учитываются.
 * Возвращает массив длины renderedLen+1: map[i] — смещение в `input`
 * каретки, стоящей перед i-м отрендеренным символом. Для сегментов, чей
 * видимый текст короче/длиннее исходного ([[page|label]], [txt](url)),
 * позиция внутри сегмента мапится пропорционально.
 */
export function clickCaretPosition(
  mapped: number,
  visibleOffset: number,
  visibleLength: number,
  sourceLength: number,
): number {
  return visibleOffset >= visibleLength ? sourceLength : mapped;
}

export function renderSourceMap(input: string): number[] {
  const map: number[] = [];
  let rendered = 0;
  // каретка j внутри сегмента [srcStart, srcEnd) с видимым текстом длины L
  const pushMapping = (len: number, srcStart: number, srcEnd: number) => {
    const srcL = srcEnd - srcStart;
    for (let j = 0; j <= len; j++) {
      map[rendered + j] = srcStart + Math.round((j * srcL) / Math.max(len, 1));
    }
    rendered += len;
  };

  const lead = input.length - input.trimStart().length;
  const trimmed = input.trim();
  let inCode = false;
  let firstCodeLine = false;
  let lineStart = lead; // смещение начала текущей строки в input
  for (const line of trimmed.split("\n")) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      firstCodeLine = inCode;
      lineStart += line.length + 1;
      continue;
    }
    if (inCode) {
      // строки кода в <pre> разделены реальными "\n" — это видимые символы
      if (!firstCodeLine) {
        pushMapping(1, lineStart - 1, lineStart - 1);
      }
      firstCodeLine = false;
      pushMapping(line.length, lineStart, lineStart + line.length);
    } else {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const textStart = lineStart + h[1].length + 1;
        for (const leaf of flatInline(h[2])) {
          pushMapping(leaf.text.length, textStart + leaf.start, textStart + leaf.end);
        }
      } else {
        for (const leaf of flatInline(line)) {
          pushMapping(leaf.text.length, lineStart + leaf.start, lineStart + leaf.end);
        }
      }
    }
    lineStart += line.length + 1;
  }
  return map;
}
