import type { BlockDto, BlockRefDto, PageDto } from "./api.ts";
import { uniqueBlockRefIds } from "./blockRefs.ts";
import type { InlineSegment } from "./text.ts";
import { formatJournalName, parseInline, splitMdBlocks, unescapeLeadingDash } from "./text.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderSegments(
  segments: InlineSegment[],
  refs: Record<string, BlockRefDto>,
  images: Record<string, string>,
): string {
  return segments.map((segment) => {
    const children = renderSegments(segment.children ?? [], refs, images);
    switch (segment.type) {
      case "link":
      case "tag":
        return `<span class="${segment.type === "link" ? "wikilink" : "hashtag"}">${escapeHtml(segment.text)}</span>`;
      case "blockRef": {
        const target = refs[segment.target ?? ""];
        return escapeHtml(target?.found ? target.text : segment.text);
      }
      case "image": {
        const source = segment.target ?? "";
        const url = httpUrl(source) ? source : images[source];
        if (!url) return `<span class="image-fallback">🖼 ${escapeHtml(segment.text || source)}</span>`;
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(segment.text)}">`;
      }
      case "url":
        if (!httpUrl(segment.target ?? "")) return escapeHtml(segment.text);
        return `<a href="${escapeHtml(segment.target ?? "")}" target="_blank" rel="noopener noreferrer">${escapeHtml(segment.text)}</a>`;
      case "bold":
        return `<strong>${children}</strong>`;
      case "italic":
        return `<em>${children}</em>`;
      case "strike":
        return `<s>${children}</s>`;
      case "code":
        return `<code>${escapeHtml(segment.text)}</code>`;
      case "highlight":
        return `<mark>${children}</mark>`;
      default:
        return escapeHtml(unescapeLeadingDash(segment.text));
    }
  }).join("");
}

function renderRichText(
  text: string,
  refs: Record<string, BlockRefDto>,
  images: Record<string, string>,
): string {
  return splitMdBlocks(text.trim()).map((block) => {
    if (block.kind === "code") {
      const language = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : "";
      return `<pre><code${language}>${escapeHtml(block.text)}</code></pre>`;
    }
    const content = renderSegments(parseInline(block.text), refs, images);
    if (block.kind === "heading") {
      const level = Math.min(6, Math.max(2, block.level + 1));
      return `<h${level}>${content}</h${level}>`;
    }
    return `<p>${content}</p>`;
  }).join("");
}

function visibleBlockText(block: BlockDto): string {
  const extra: string[] = [];
  let inLogbook = false;
  for (const line of block.extra) {
    const trimmed = line.trim();
    if (trimmed === ":LOGBOOK:") {
      inLogbook = true;
      continue;
    }
    if (inLogbook) {
      if (trimmed === ":END:") inLogbook = false;
      continue;
    }
    if (/^[^\s:]+::/.test(trimmed) || trimmed.startsWith("CLOCK:")) continue;
    extra.push(line);
  }
  return [block.content, ...extra].filter((line) => line.length > 0).join("\n");
}

function renderBlocks(
  blocks: BlockDto[],
  refs: Record<string, BlockRefDto>,
  images: Record<string, string>,
): string {
  if (blocks.length === 0) return "";
  let previous = 0;
  let html = "<ul>";
  blocks.forEach((block, index) => {
    const level = index === 0 ? 0 : Math.max(0, Math.min(block.indent, previous + 1));
    if (index > 0 && level === previous) html += "</li>";
    if (level > previous) html += "<ul>";
    if (level < previous) {
      html += "</li>";
      for (let depth = previous; depth > level; depth--) html += "</ul></li>";
    }
    html += "<li>";
    if (block.task) {
      const status = block.statusLabel ?? block.status ?? "Задача";
      const priority = block.priority ? ` ${block.priority}` : "";
      html += `<span class="task-meta">${escapeHtml(status + priority)}</span> `;
    }
    html += renderRichText(visibleBlockText(block), refs, images);
    previous = level;
  });
  html += "</li>";
  for (let depth = previous; depth > 0; depth--) html += "</ul></li>";
  return `${html}</ul>`;
}

const DOCUMENT_STYLE = `
  :root { color-scheme: light; font-family: system-ui, sans-serif; color: #202124; background: #fff; }
  body { max-width: 860px; margin: 0 auto; padding: 32px; line-height: 1.55; }
  h1 { border-bottom: 1px solid #ddd; padding-bottom: 8px; }
  section + section { margin-top: 40px; }
  ul { padding-left: 26px; }
  li { margin: 6px 0; }
  p { margin: 3px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .preamble { margin-bottom: 16px; }
  .task-meta { color: #666; font-size: .85em; font-weight: 600; }
  .wikilink, .hashtag { color: #6d3b8e; }
  a { color: #087f8c; }
  img { max-width: 100%; height: auto; }
  pre { padding: 12px; overflow-x: auto; background: #f4f5f6; border-radius: 6px; }
  code { font-family: ui-monospace, monospace; }
  mark { background: #fff0a6; }
  @page { margin: 15mm; }
  @media print { body { max-width: none; padding: 0; } li, pre { break-inside: avoid; } }
`;

export function renderPagesHtml(
  pages: PageDto[],
  refs: Record<string, BlockRefDto> = {},
  images: Record<string, string> = {},
): string {
  const title = pages.length === 1 ? pages[0].name : "Журнал";
  const sections = pages.map((page) => {
    const heading = page.kind === "journal" ? formatJournalName(page.name) : page.name;
    const preamble = page.preamble.length > 0
      ? `<div class="preamble">${renderRichText(page.preamble.join("\n"), refs, images)}</div>`
      : "";
    return `<section><h1>${escapeHtml(heading)}</h1>${preamble}${renderBlocks(page.blocks, refs, images)}</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_STYLE}</style>
</head>
<body>${sections}</body>
</html>`;
}

function pageSegments(pages: PageDto[]): InlineSegment[] {
  const texts = pages.flatMap((page) => [
    page.preamble.join("\n"),
    ...page.blocks.map(visibleBlockText),
  ]);
  return texts.flatMap((text) => splitMdBlocks(text.trim()).flatMap((block) =>
    block.kind === "code" ? [] : parseInline(block.text)));
}

function imageSegments(segments: InlineSegment[]): InlineSegment[] {
  return segments.flatMap((segment) => [
    ...(segment.type === "image" ? [segment] : []),
    ...imageSegments(segment.children ?? []),
  ]);
}

export async function preparePagesHtml(
  pages: PageDto[],
  resolveRefs: (ids: string[]) => Promise<BlockRefDto[]>,
  loadImage: (path: string) => Promise<string>,
): Promise<string> {
  const segments = pageSegments(pages);
  const ids = uniqueBlockRefIds(segments);
  const paths = [...new Set(imageSegments(segments)
    .map((segment) => segment.target ?? "")
    .filter((path) => path && !httpUrl(path)))];
  const [resolved, loaded] = await Promise.all([
    ids.length > 0 ? resolveRefs(ids).catch(() => []) : Promise.resolve([]),
    Promise.all(paths.map(async (path) => {
      try {
        return [path, await loadImage(path)] as const;
      } catch {
        return null;
      }
    })),
  ]);
  const refs = Object.fromEntries(resolved.map((ref) => [ref.uuid, ref]));
  const images = Object.fromEntries(loaded.filter((entry) => entry !== null));
  return renderPagesHtml(pages, refs, images);
}

export function exportFileStem(pages: PageDto[]): string {
  const raw = pages.length === 0
    ? "logtask-export"
    : pages.length === 1
      ? pages[0].name
      : `${pages[0].name}—${pages[pages.length - 1].name}`;
  return raw.replace(/[\\/:*?"<>|]/g, "_") || "logtask-export";
}
