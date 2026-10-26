# Visual Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать глобальный и локальный визуальные графы Logtask со всеми фильтрами, группами, навигацией, сохранением layout и live-обновлением за ≤5–10 секунд.

**Architecture:** Rust проецирует текущий in-memory `Graph` в компактные DTO и выполняет детерминированный BFS. SolidJS управляет видом и настройками; WebGL2 рисует сцену, Web Worker с `d3-force` считает layout без блокировки UI. Настройки живут в `.logtask/settings.json`, производные координаты — в атомарно заменяемом `.logtask/graph-layout.json`.

**Tech Stack:** Rust 1.77+, serde, Tauri 2; TypeScript strict, SolidJS, WebGL2, Web Worker, `d3-force` + `@types/d3-force`; CSS-переменные `global.css`.

**Spec:** `docs/specs/2026-10-26-visual-graph-design.md`

## Global Constraints

- `.md` — единственный источник истины; визуальный граф не меняет markdown и не нарушает round-trip.
- `Graph.backlinks` не создаёт дополнительных рёбер; `LinkTarget::Block` не создаёт page-edge.
- Все строки UI и комментарии — на русском; имена DTO совпадают через `serde(rename_all = "camelCase")`.
- Новые команды добавляются в `commands.rs`, `lib.rs` и `src/lib/api.ts`.
- WebGL2 обязателен для основной сцены; SVG/DOM-узлы на каждый элемент запрещены.
- Layout работает в Worker; в покое нет постоянных тиков физики или перерисовки.
- Live-обновление после `graph-changed`: ≤5 с при обычной нагрузке, ≤10 с на 10 000 узлов.
- Не использовать `innerHTML`; стили только в `public/styles/global.css`, цвета через переменные и настройки групп.
- Скрытая сцена приостанавливает физику и рендеринг; использовать `contentvisibilityautostatechange`, а при его отсутствии — `IntersectionObserver`.
- Canvas масштабируется через `ResizeObserver` с учётом `devicePixelRatio`; клавиатура и `:focus-visible` обязательны.

## Review Focus

- Одноимённые страница/тег и встречные/повторные ссылки: не должны дублировать узлы и рёбра — Task 1, тест проекции.
- Повреждённый layout, смена графа и устаревший ответ IPC: не должны смешивать координаты или блокировать открытие — Tasks 2, 3 и 8, тесты загрузки и guard по root/generation.
- Пустой граф, изолированные узлы, петли и отсутствие пути: не должны давать NaN в физике или ложный путь — Tasks 1 и 5, тесты BFS и стартовых координат.
- Скрытая страница во время длинного layout: не должна потреблять CPU или применять устаревшие позиции — Tasks 5 и 8, ручная проверка Worker generation/pause.
- WebGL context loss, нулевой размер панели и кириллица в подписях: должны давать восстановление/безопасный пропуск без потери данных — Tasks 5 и 9, ручная проверка и smoke-сценарий.

---

### Task 1: Проекция страниц, ссылок, вложений и алгоритмы ядра

**Files:**
- Create: `src-tauri/src/core/visual_graph.rs`
- Modify: `src-tauri/src/core.rs`, `src-tauri/src/core/model.rs`, `src-tauri/src/core/parser.rs`, `src-tauri/src/core/index.rs`, `src-tauri/src/commands.rs` (match `LinkTarget` в `BlockDto`)
- Test: unit-тесты в `visual_graph.rs` и `core.rs`

**Interfaces:**
- Produces: `LinkTarget::Asset(String)`.
- Produces: `GraphNodeDto { id, title, kind, path, tags, degree, asset_path, exists }`, `GraphEdgeDto { id, source, target, weight }`, `GraphSnapshotDto { nodes, edges, revision }`.
- Produces: `Graph::visual_snapshot() -> GraphSnapshotDto`, `Graph::shortest_path(visible_ids: &HashSet<String>, from: &str, to: &str) -> Option<Vec<String>>`, `Graph::local_snapshot(root: &str, depth: u8, visible_ids: &HashSet<String>) -> GraphSnapshotDto`.

- [ ] **Step 1: Написать падающие тесты парсера вложений**

Добавить assertions: `![[../assets/a.mp4]]`, `![alt](assets/a.png)`, `[файл](../assets/a.pdf)` дают `Asset("assets/…")`; URL, абсолютный путь и `../../outside` не дают `Asset`; round-trip всех строк сохраняется байт-в-байт.

- [ ] **Step 2: Прогнать тесты и убедиться в падении**

Run: `cargo test --workspace asset_link`
Expected: FAIL — `LinkTarget::Asset` и распознавание отсутствуют.

- [ ] **Step 3: Реализовать `Asset` и обновить все exhaustive match**

Распознавание добавить в `extract_links`, включая содержимое сырых trailing-строк, если сейчас они не проходят через него. Нормализовать только `assets/…` и `../assets/…` к `assets/…`; существующий `resolve_asset_path` использовать для проверки безопасного пути при открытии, не читать файл при индексации.

- [ ] **Step 4: Написать падающие тесты проекции и BFS**

Собрать граф из страниц A/B/C и журнала. Проверить: одно ребро при повторных A→B, вес 2; встречная ссылка — второе ребро; backlink не дублирует ребро; page/tag с именем B — один узел; степень считает уникальных соседей; петля не создаёт соседа; виртуальная цель имеет `exists=false`; BFS игнорирует направление, сортирует соседей по id, возвращает `None` при скрытом промежуточном узле; local depth 1/2 ограничивает узлы, root присутствует.

- [ ] **Step 5: Прогнать новые тесты — должны падать**

Run: `cargo test --workspace visual_graph`
Expected: FAIL — модуль проекции отсутствует.

- [ ] **Step 6: Реализовать `visual_graph.rs`**

Использовать стабильные `page:`, `journal:`, `asset:` ключи; `kind` сериализовать как `page|journal|tag|virtual|asset`. Собрать nodes/edges за O(blocks+links), отсортировать выход по id. `revision` вычислять детерминированным хэшем снимка, не временем. BFS выполнять по отфильтрованному списку рёбер; local depth ограничен 1–3.

- [ ] **Step 7: Прогнать ядро и round-trip**

Run: `cargo test --workspace`
Expected: PASS, включая существующие round-trip fixtures.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/core.rs src-tauri/src/core src-tauri/src/commands.rs
git commit -m "Фаза 7: проекция визуального графа в ядре"
```

---

### Task 2: Настройки и устойчивое хранение layout

**Files:**
- Create: `src-tauri/src/graph_layout.rs`
- Modify: `src-tauri/src/settings.rs`, `src-tauri/src/lib.rs`
- Test: unit-тесты в обоих файлах

**Interfaces:**
- Produces: `GraphViewSettings::default()` с `showJournals=false`, `showTags=false`, `showAssets=false`, `onlyExisting=true`, `hideOrphans=false`, `localDepth=1`, `journalAggregation="month"`, `clusterThreshold=20`.
- Produces: `GraphColorGroup { id, query, color, enabled, clustered }`, `GraphViewSettings { search, show_*, only_existing, hide_orphans, exclusions, groups, arrows, node_scale, edge_scale, label_threshold, center_force, repel_force, link_force, link_distance, alpha_decay, local_depth, journal_aggregation, cluster_threshold }`.
- Produces: `GraphLayoutEntry { id, x, y, pinned }`, `LayoutScope { scope, entries }`, `load(root) -> Vec<LayoutScope>`, `save_scope(root, scope, entries) -> io::Result<()>`.

- [ ] **Step 1: Написать падающие тесты defaults и совместимости**

Старый settings JSON без `graphView` должен загрузить defaults; round-trip сохраняет группы, фильтры, физику и глубину. Для layout проверить отсутствующий файл, пустой объект, частично невалидные записи, неизвестную версию, NaN/бесконечности и независимость scope `global`/`local:page:A`.

- [ ] **Step 2: Прогнать тесты — должны падать**

Run: `cargo test --workspace graph_view_settings graph_layout`
Expected: FAIL — типы и модуль отсутствуют.

- [ ] **Step 3: Реализовать настройки и layout**

Все новые поля `#[serde(default)]`; числа валидировать конечностью, координаты не ограничивать произвольно. Хранить `{version:1, scopes:[…]}`; читать валидные записи независимо от повреждённых соседних. Сохранять только один scope атомарно через `core::fswrite::atomic_write`, не трогать другие scope.

- [ ] **Step 4: Прогнать тесты и форматирование**

Run: `cargo test --workspace settings graph_layout && cargo fmt --check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs src-tauri/src/graph_layout.rs src-tauri/src/lib.rs
git commit -m "Фаза 7: настройки и сохранение раскладки графа"
```

---

### Task 3: IPC-контракт графа и типизированный frontend API

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/api.ts`
- Test: Rust command-adjacent unit-тесты; `npm run typecheck`

**Interfaces:**
- Consumes: интерфейсы Tasks 1–2.
- Produces IPC: `visual_graph_snapshot`, `visual_graph_local(root, depth, visibleIds)`, `visual_graph_path(visibleIds, from, to)`, `visual_graph_layout_get(scope)`, `visual_graph_layout_save(scope, entries)`, `asset_open(path)`, `asset_reveal(path)`.
- Produces TS: одноимённые camelCase-обёртки и DTO из Tasks 1–2.

- [ ] **Step 1: Добавить compile-time usage и тесты ошибок**

Проверить `граф не загружен`, `depth` вне 1–3, пустые from/to, отсутствующий scope и небезопасный asset path. Добавить TS-вызовы ожидаемых сигнатур.

- [ ] **Step 2: Прогнать и убедиться в падении**

Run: `cargo test --workspace visual_graph_command; npm run typecheck`
Expected: FAIL — команды и обёртки отсутствуют.

- [ ] **Step 3: Реализовать команды и зарегистрировать их**

Команды читают существующий `AppState.graph` под read-lock и root отдельно; длинных файловых операций под graph-lock не выполнять. Layout save принимает максимум 50 000 записей и использует Task 2. Asset actions используют существующий безопасный resolver и opener.

- [ ] **Step 4: Прогнать контрактные проверки**

Run: `cargo test --workspace && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "Фаза 7: IPC визуального графа"
```

---

### Task 4: Модель сцены, фильтры, цветовые группы и кластеры

**Files:**
- Create: `src/lib/graph/model.ts`, `src/lib/graph/defaults.ts`
- Modify: `src/lib/api.ts` (TS-типы настроек), `src/App.tsx` (`DEFAULT_SETTINGS`)
- Test: deterministic fixture через TypeScript compile check; ручной fixture-сценарий в Task 10

**Interfaces:**
- Produces: `filterGraph(snapshot, settings) -> GraphSnapshotDto`.
- Produces: `colorForNode(node, groups) -> string | null`, `matchesGraphQuery(node, query) -> boolean` с `tag:`, `name:`, `path:`, `kind:` и AND для слов.
- Produces: `clusterGraph(snapshot, settings, expanded) -> SceneGraph`; `SceneNode = GraphNodeDto & { clusterMembers?: string[] }`.
- Produces: `shortestVisiblePath` использует несвёрнутый filtered snapshot, затем `projectPathToClusters` для подсветки кластеров.

- [ ] **Step 1: Зафиксировать failing fixture-сценарий**

Подготовить fixture на страницу, журнал, tag/virtual/asset, сироту и пересекающиеся группы. Ожидания: defaults показывают только обычные страницы; glob-исключения работают; `hideOrphans` применяется последним; первое правило выигрывает; узел входит максимум в один кластер; внутренние рёбра скрыты; внешние агрегированы; пустой кластер исчезает.

- [ ] **Step 2: Прогнать проверку до реализации**

Run: `npm run typecheck`
Expected: FAIL — экспорты модели отсутствуют.

- [ ] **Step 3: Реализовать чистые функции модели**

Не изменять входной snapshot. Поддержать `*` glob без RegExp-инъекций, Unicode casefold через `toLocaleLowerCase("ru")`. Группа имеет приоритет над journal aggregation; локальный режим вызывает только `filterGraph`, не `clusterGraph`.

- [ ] **Step 4: Проверить типы и fixture в браузере**

Run: `npm run typecheck`
Expected: PASS; fixture выводит ожидаемые id/edges без мутации исходного snapshot.

- [ ] **Step 5: Commit**

```bash
git add src/lib/graph src/lib/api.ts src/App.tsx
git commit -m "Фаза 7: фильтры и группы визуального графа"
```

---

### Task 5: WebGL renderer, Worker layout и базовый глобальный вид

**Files:**
- Create: `src/components/graph/WebGlRenderer.ts`, `src/components/graph/GraphCanvas.tsx`, `src/components/graph/GraphView.tsx`, `src/lib/graph/layout.worker.ts`, `src/lib/graph/layout.ts`
- Modify: `package.json`, `package-lock.json`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/icons.tsx`, `public/styles/global.css`
- Test: `npm run build`, ручной smoke на текущем графе

**Interfaces:**
- Consumes: IPC Task 3 и модель Task 4.
- Produces: `GraphView { refreshKey, settings, onSettingsChange, onOpenPage, initialSelectedId? }`.
- Produces Worker protocol: `init {nodes,edges,settings,seed,positions}`, `update`, `params`, `drag`, `pause`, `resume`, `stop`; ответы `positions {generation,xy}`, `settled {generation}`.
- Produces renderer: `setScene`, `setPositions`, `setCamera`, `setHighlight`, `hitTest`, `fit`, `dispose`.

- [ ] **Step 1: Установить физику и написать failing integration shell**

Добавить `d3-force` и `@types/d3-force` через npm. Подключить `GraphView` к View `{kind:"graph"}`, сайдбару и истории App; начальный smoke ожидает узлы текущего графа и рабочие кнопки zoom/pan.

- [ ] **Step 2: Проверить падение до реализации**

Run: `npm run typecheck`
Expected: FAIL — компоненты и renderer отсутствуют.

- [ ] **Step 3: Реализовать Worker и детерминированный layout**

Использовать `forceSimulation`, `forceManyBody` (его quadtree/Barnes–Hut), `forceLink`, `forceCenter`; seed и стартовые позиции — stable hash id. Закреплённые узлы получают fx/fy. Каждое сообщение имеет generation; старые ответы отбрасываются. Отправлять позиции батчами и остановиться при `alpha < alphaMin`; NaN заменять детерминированной стартовой позицией.

- [ ] **Step 4: Реализовать WebGL2 scene**

Пакетные shaders для line/triangle и круглых point sprites; противоположные рёбра разводить кривыми/смещением, петли рисовать отдельно. Подписи — atlas из Canvas 2D, не DOM/SVG на узел. `ResizeObserver` масштабирует backing store по DPR; размер 0 пропускает render. При отсутствии WebGL2 показывать понятную ошибку, не падать.

- [ ] **Step 5: Реализовать камеру, hit-testing и приостановку**

Wheel zoom вокруг курсора, pointer pan, кнопки ±/fit, touch pinch. Рендерить только по dirty flag/requestAnimationFrame. Добавить `content-visibility:auto` + `contain-intrinsic-size`, прямой `contentvisibilityautostatechange`; fallback `IntersectionObserver` и `document.visibilitychange` останавливают Worker/rAF.

- [ ] **Step 6: Прогнать build и smoke**

Run: `npm run build`
Expected: PASS. В приложении: «Граф» открывает все обычные страницы, pan/zoom работают во время симуляции, после settle CPU прекращает непрерывную работу.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src public/styles/global.css
git commit -m "Фаза 7: WebGL-граф и фоновая раскладка"
```

---

### Task 6: Выбор, путь, контекстные меню и доступность

**Files:**
- Create: `src/components/graph/GraphMenu.tsx`, `src/components/graph/GraphToolbar.tsx`
- Modify: `src/components/graph/GraphCanvas.tsx`, `src/components/graph/GraphView.tsx`, `src/components/graph/WebGlRenderer.ts`, `public/styles/global.css`

**Interfaces:**
- Produces: состояние `selection: {first,second,path,message} | null`.
- Produces callbacks `onOpenPage(name)`, `onCopyLink(name)`, `onHideNode(id)`, `onOpenGlobal(id)`.
- Produces clipboard/open/reveal действия через Task 3 и существующий opener API.

- [ ] **Step 1: Записать failing interaction checklist**

Проверить hover, first/second click, отсутствие пути, третий click, повторный click, blank/Escape, double click, drag/pin/unpin, меню страницы/asset/cluster. Проверить Tab/Shift+Tab, Enter, arrows, +/- и видимый focus.

- [ ] **Step 2: Реализовать состояние выбора и путь**

BFS вызывать по filtered snapshot, не по кластерной сцене; подсвечивать проекцию пути на кластеры. Кластер только expand/collapse и не участвует в выборе endpoints. Hover не перезаписывает click selection.

- [ ] **Step 3: Реализовать меню и клавиатурную модель**

Использовать native `<button>` для меню, focus-visible и минимум 24×24 px. Canvas получает `tabindex=0`, `role=application`, доступное имя и `aria-activedescendant`; один скрытый active-descendant элемент описывает название, тип и degree. Tab/Shift+Tab внутри graph navigation реализовать roving focus без DOM на каждый узел, обычный выход из виджета сохранить по Ctrl+Tab/переходу на панель.

- [ ] **Step 4: Проверить взаимодействие и сборку**

Run: `npm run build`
Expected: PASS; checklist Step 1 выполнен мышью и только клавиатурой, reduced-motion отключает анимации камеры.

- [ ] **Step 5: Commit**

```bash
git add src/components/graph public/styles/global.css
git commit -m "Фаза 7: навигация и взаимодействие визуального графа"
```

---

### Task 7: Панель настроек и локальный граф

**Files:**
- Create: `src/components/graph/GraphSettings.tsx`, `src/components/graph/LocalGraph.tsx`
- Modify: `src/App.tsx`, `src/components/graph/GraphView.tsx`, `public/styles/global.css`

**Interfaces:**
- Produces: `GraphSettings {settings,onChange,onRecalculate,onReset}` для всех полей Task 2.
- Produces: `LocalGraph {page,refreshKey,settings,onOpenPage,onOpenGlobal}`.
- App: правая панель имеет tabs «Оглавление», «Связи», «Настройки графа» в соответствующих режимах.

- [ ] **Step 1: Подключить failing UI routes**

Добавить tabs и `LocalGraph`; ожидания: depth 1–3, центральная страница игнорирует исключение, фильтры/группы/physics общие, aggregation отсутствует, click меняет активную страницу, «Открыть в глобальном» выбирает и центрирует узел.

- [ ] **Step 2: Реализовать панель всех обязательных настроек**

Добавить поиск, toggles, exclusions, упорядоченный редактор групп с цветом/enabled/clustered, display и physics sliders с числовыми значениями, aggregation и подтверждения reset/recalculate. Сохранение использовать через существующий `saveSettingsAuto`.

- [ ] **Step 3: Реализовать локальное окружение и отдельные scope**

Вызывать `visualGraphLocal`; сохранять camera по root и layout `local:<id>`. Не создавать второй Worker/renderer для невидимой вкладки; при переключении освобождать ресурсы.

- [ ] **Step 4: Прогнать build и ручной сценарий**

Run: `npm run build`
Expected: PASS; все настройки применяются live и переживают reload, локальный граф соответствует Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/graph public/styles/global.css
git commit -m "Фаза 7: локальный граф и настройки отображения"
```

---

### Task 8: Live-обновление, кэш, инкрементальность и сохранение камеры

**Files:**
- Create: `src/lib/graph/live.ts`, `src/lib/graph/persistence.ts`
- Modify: `src/components/graph/GraphView.tsx`, `src/components/graph/LocalGraph.tsx`, `src/components/graph/GraphCanvas.tsx`

**Interfaces:**
- Produces: `LatestSnapshotLoader` с `request()`, отменой устаревшего root/generation и одним trailing request при событии во время загрузки.
- Produces: `loadScope`, `scheduleSave`, `flush`, `cameraKey(root,scope)`.

- [ ] **Step 1: Написать failing live-сценарий**

События в t=0/100/200 мс дают один текущий запрос и максимум один trailing; устаревший ответ старого root отбрасывается. Сохранённые координаты surviving id не меняются, новые получают deterministic position, deleted исчезают, selection/camera сохраняются.

- [ ] **Step 2: Реализовать live loader**

Подписаться на существующий `refreshKey`/graph-changed поток App; не добавлять второй watcher. Не ждать polling: запрос сразу после события, коалесцировать только параллельные загрузки. Логировать превышение 5/10 с как ошибку производительности.

- [ ] **Step 3: Реализовать persistence и инкрементальный diff**

Загружать layout до первого settle; сохранять positions debounce 500 мс и flush при stop/unmount. Камера, expanded и режим панели — localStorage по root/scope. Обновлять maps и GPU buffers по id, не пересоздавать компонент; pinned и camera сохранять.

- [ ] **Step 4: Проверить реальные изменения**

Run: `npm run build && cargo test --workspace`
Expected: PASS. В приложении изменить ссылку в Logtask и внешним редактором: оба графа обновляются ≤5 с на текущем графе без ручного refresh; перезапуск восстанавливает состояние.

- [ ] **Step 5: Commit**

```bash
git add src/lib/graph src/components/graph
git commit -m "Фаза 7: живое обновление и восстановление графа"
```

---

### Task 9: Подписи, автоматические упрощения и нагрузочные проверки

**Files:**
- Create: `src/lib/graph/performance.ts`, `src-tauri/examples/bench_visual_graph.rs`
- Modify: `src/components/graph/WebGlRenderer.ts`, `src/components/graph/GraphView.tsx`, `src/lib/graph/layout.worker.ts`
- Test: benchmark example + `npm run build` + ручной Performance-профиль

**Interfaces:**
- Produces: `QualityController {sample(frameMs),effective(settings,visibleCounts),reset}`.
- Produces: генератор deterministic synthetic graphs 1k/3k/5k/10k nodes и до 25k edges.

- [ ] **Step 1: Подготовить нагрузочные fixtures и измерения**

Замерять TTI, cached open, frame-time p95, long tasks, задержку graph-changed→scene и CPU в простое. Добавить маркеры `performance.mark/measure` без вывода пользовательского текста в HTML.

- [ ] **Step 2: Реализовать quality levels**

Уровни: полный → снижение Worker tick rate → скрытие второстепенных labels → отключение arrows/effects → aggregation. Порядок восстановления обратный, с гистерезисом; ручные настройки не перезаписываются. Labels зависят от viewport, zoom и приоритета selection/hover/path.

- [ ] **Step 3: Реализовать восстановление WebGL и benchmark**

Обработать `webglcontextlost` через preventDefault/pause и `webglcontextrestored` через rebuild buffers, сохранив модель. Benchmark генерирует снимки и проверяет проекцию/BFS без файлового I/O.

- [ ] **Step 4: Прогнать бюджеты**

Run: `cargo run --release --example bench_visual_graph && npm run build`
Expected: PASS. Release UI: 1k TTI ≤2 с, cached ≤300 мс; 3k/7.5k p95 ≥30 FPS; 5k каркас <1 с; 10k/25k без блокировки >2 с; live update ≤10 с. Невыполненные цифры фиксировать как blocker, не объявлять задачу завершённой.

- [ ] **Step 5: Commit**

```bash
git add src src-tauri/examples/bench_visual_graph.rs
git commit -m "Фаза 7: масштабирование визуального графа"
```

---

### Task 10: Документация и сквозная приёмка

**Files:**
- Modify: `docs/01-architecture.md`, `docs/02-format.md`, `docs/03-ui.md`, `docs/04-roadmap.md`, `AGENTS.md`
- Modify: `docs/plans/2026-10-26-visual-graph.md` (отметки выполненных шагов)

- [ ] **Step 1: Обновить проектные контракты**

Описать `visual_graph.rs`, Asset links, новые IPC, WebGL/Worker, `.logtask/graph-layout.json`, tabs и настройки, live latency. Отметить визуальный граф реализованным, не меняя правила markdown.

- [ ] **Step 2: Прогнать все стандартные проверки**

Run: `cargo fmt && cargo fmt --check && cargo clippy --workspace -- -D warnings && cargo test --workspace && npm run build`
Expected: все команды PASS.

- [ ] **Step 3: Выполнить полный acceptance checklist спеки**

Проверить все разделы 4–16, включая tags/assets/virtual/orphans, группы, local depth, меню, клавиатуру, обе темы, reduced motion, перезапуск, повреждённый layout, смену графа, внешнюю правку и Syncthing-подобную запись. Непроверенные нагрузочные пункты явно перечислить пользователю как оставшиеся блокеры.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs
git commit -m "Фаза 7: документация визуального графа"
```
