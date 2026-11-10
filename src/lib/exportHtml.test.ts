import assert from "node:assert/strict";
import test from "node:test";
import type { BlockDto, BlockRefDto, PageDto } from "./api.ts";
import { exportFileStem, preparePagesHtml, renderPagesHtml } from "./exportHtml.ts";

function block(content: string, indent = 0, overrides: Partial<BlockDto> = {}): BlockDto {
  return {
    uuid: crypto.randomUUID(),
    status: null,
    statusLabel: null,
    priority: null,
    content,
    indent,
    task: false,
    urgency: null,
    importance: null,
    links: [],
    clockRunning: false,
    clockTotal: null,
    deadline: null,
    scheduled: null,
    extra: [],
    source: content,
    ...overrides,
  };
}

function page(blocks: BlockDto[], overrides: Partial<PageDto> = {}): PageDto {
  return { name: "Страница", kind: "page", blocks, preamble: [], ...overrides };
}

test("страница сохраняет содержимое, форматирование и вложенность без служебных строк", () => {
  const html = renderPagesHtml([
    page([
      block("TODO Родитель", 0, {
        status: "TODO",
        statusLabel: "К выполнению",
        priority: "[#A]",
        task: true,
        extra: [
          "**жирный** и *курсив*",
          "urgency:: high",
          "importance:: high",
          "owner:: nobody",
          ":LOGBOOK:",
          "CLOCK: [2026-11-10 Tue 10:00:00]",
          ":END:",
          "```rust",
          "let x = 1;",
          "```",
        ],
      }),
      block("# Заголовок", 1),
      block("`код`", 1),
    ], { preamble: ["Преамбула"] }),
    page([], { name: "Вторая" }),
  ]);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<meta charset="UTF-8">/);
  assert.match(html, /<h1>Страница<\/h1>/);
  assert.match(html, /Преамбула/);
  assert.match(html, /<span class="task-meta">К выполнению \[#A\]<\/span>/);
  assert.doesNotMatch(html, /\[#\[#A\]\]/);
  assert.match(html, /<strong>жирный<\/strong>/);
  assert.match(html, /<em>курсив<\/em>/);
  assert.match(html, /<code class="language-rust">let x = 1;<\/code>/);
  assert.match(html, /<h2>Заголовок<\/h2>/);
  assert.ok(html.indexOf("Страница") < html.indexOf("Вторая"));
  assert.doesNotMatch(html, /urgency::|importance::|owner::|LOGBOOK|CLOCK:/);
  assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length);
});

test("пользовательский HTML экранируется, внутренние ссылки остаются текстом, внешние кликабельны", () => {
  const html = renderPagesHtml([
    page([
      block('<script>alert("x")</script> & [[Target|Alias]] #тег [сайт](https://example.com/?a=1&b="2")'),
      block("![внешняя](https://example.com/a.png)"),
      block("[плохая](javascript:alert(1))"),
    ]),
  ]);

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /Alias/);
  assert.doesNotMatch(html, /\[\[Target/);
  assert.match(html, /#тег/);
  assert.match(html, /<a href="https:\/\/example.com\/\?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">сайт<\/a>/);
  assert.match(html, /<img src="https:\/\/example.com\/a.png"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

const REF_ONE = "00000000-0000-4000-8000-000000000001";
const REF_TWO = "00000000-0000-4000-8000-000000000002";

test("block refs раскрываются, а отсутствующие остаются исходным текстом", () => {
  const refs: Record<string, BlockRefDto> = {
    [REF_ONE]: { uuid: REF_ONE, blockUuid: "source", page: "Источник", text: "Текст ссылки", found: true },
    [REF_TWO]: { uuid: REF_TWO, blockUuid: REF_TWO, page: "", text: "", found: false },
  };
  const html = renderPagesHtml([page([block(`((${REF_ONE})) и ((${REF_TWO}))`)])], refs);
  assert.match(html, /Текст ссылки/);
  assert.match(html, new RegExp(`\\(\\(${REF_TWO}\\)\\)`));
});

test("подготовка дедуплицирует refs и картинки, ошибки ресурсов дают текстовый fallback", async () => {
  let requestedIds: string[] = [];
  const loaded: string[] = [];
  const html = await preparePagesHtml(
    [page([block(`((${REF_ONE})) ((${REF_ONE})) ![\"alt\"](../assets/a.png) ![плохая](../assets/b.png)`)])],
    async (ids) => {
      requestedIds = ids;
      return [{ uuid: REF_ONE, blockUuid: "source", page: "Источник", text: "Превью", found: true }];
    },
    async (path) => {
      loaded.push(path);
      if (path.includes("b.png")) throw new Error("нет файла");
      return "data:image/png;base64,AA==";
    },
  );

  assert.deepEqual(requestedIds, [REF_ONE]);
  assert.deepEqual(loaded, ["../assets/a.png", "../assets/b.png"]);
  assert.match(html, /data:image\/png;base64,AA==/);
  assert.match(html, /alt="&quot;alt&quot;"/);
  assert.match(html, /🖼 плохая/);
  assert.doesNotMatch(html, /src="\.\.\/assets\/b.png"/);
});

test("скачки отступов нормализуются и списки закрываются", () => {
  const html = renderPagesHtml([page([block("A", 0), block("B", 3), block("C", 1)])]);
  assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length);
  assert.ok(html.indexOf("A") < html.indexOf("B"));
  assert.ok(html.indexOf("B") < html.indexOf("C"));
});

test("имена файлов безопасны и отражают страницу или диапазон журнала", () => {
  assert.equal(exportFileStem([page([], { name: 'А/Б:"черновик"' })]), "А_Б__черновик_");
  assert.equal(exportFileStem([
    page([], { name: "2026_11_10", kind: "journal" }),
    page([], { name: "2026_11_08", kind: "journal" }),
  ]), "2026_11_10—2026_11_08");
  assert.equal(exportFileStem([]), "logtask-export");
});
