# Архитектура

## Стек
- **Ядро (Rust, крейт `logtask`, lib `logtask_lib`, модуль `core`)**: парсер
  outliner-формата, модель данных, индекс графа, query-движок, запись.
  Чистая логика, всё тестируется unit-тестами.
- **Хост-приложение (Tauri 2, `src-tauri`)**: создание окна, IPC-команды,
  файловый watcher, логирование. webkit2gtk-4.1 (уже установлен).
  Трей реализован в `tray.rs`; события до готовности frontend накапливаются
  в `AppState.tray_events` и выдаются через IPC `tray_ready`. При недоступном
  трее крестик не скрывает окно. Глобальные сочетания Wayland реализованы
  в `shortcuts/`; их события используют общую с треем очередь действий.
  - `sync/` — синхронизация задач с внешними источниками (docs/05-integrations.md):
    адаптеры generic/gitea/github/gitlab, merge с защитой от конфликтов,
    состояние в `.logtask/integrations-state.json`, токены в системном keyring.
    `AppState.graph_epoch` отменяет устаревшие merge/save/reindex после смены
    или закрытия графа. Запись в граф — только через
    Graph::mutate_block/append_block/delete_block.
- **Интерфейс (SolidJS + TypeScript, Vite, `src/`)**: лента журнала, канбан,
  матрица, настройки. SolidJS — мелкозернистая реактивность (без Virtual DOM),
  рендерит только то, что изменилось.

Почему не Electron: целевая характеристика — «отклик за доли секунд», а
Electron + ClojureScript — главная причина медленного Logseq.
Почему не чисто нативный (Qt): несоизмеримо больше работы при равном UX.

## Слои и поток данных
```
.md файлы (единственный источник истины)
        │  чтение/запуск
        ▼
logtask::core — in-memory граф (блоки, страницы, теги, ссылки, обратные ссылки)
        ▲                         │
        │ notify (inotify)         │ IPC (serde)
        │ внешние изменения        ▼
src-tauri (команды) ←————→ SolidJS UI
```
- На старте индекс строится полным проходом по `journals/` и `pages/`
  (706 файлов / 7 МБ — фон, бюджет <100 мс, замер 72 мс).
- `notify` следит за изменениями снаружи (Syncthing, ручное редактирование):
  на событие — **полная переиндексация графа** (дешевле, чем инкремент,
  ~72 мс), события доступа фильтруются, дребезг коалесцируется окном
  тишины 350 мс.
- Команды записи: `mutate_block` перезаписывает страницу и перечитывает её
  в памяти (`reload_page`), затем `reindex_and_emit` — **полная переиндексация
  графа** (~72 мс) и emit `graph-changed`. Watcher коалесцирует пути `.md`
  событий и сравнивает хэш содержимого с индексом: собственное неизменённое эхо
  пропускается, а внешняя правка запускает переиндексацию даже при совпадающем
  mtime и сразу после собственной записи.
- Отдельная фоновая задача раз в минуту проверяет смену суток: создаёт файл
  нового журнала и вызывает `reindex_and_emit`; останавливается при смене или
  закрытии графа.
- Никакой БД на диске не нужна. Исключение — производный, безопасно удаляемый
  `.logtask/graph-layout.json`: только координаты и фиксация узлов визуального
  графа, не источник данных.
- `core/visual_graph.rs` проецирует страницы, теги, виртуальные страницы и
  вложения в DTO, считает уникальные рёбра/степени, локальное окружение и BFS.
  Глобальный и локальный графы рисуются WebGL2, force-layout работает в Web
  Worker (`d3-force`). По `graph-changed` снимок запрашивается заново с
  коалесцированием параллельных запросов; задержка обновления сцены ≤5 с на
  обычном графе и ≤10 с на 10 000 узлов. Сохранённая раскладка при повторном
  открытии показывается одним статичным кадром без повторного нагрева симуляции;
  физика включается при миграции, изменении сцены/настроек и перетаскивании.
  Стартовый домашний вид монтируется только после загрузки графа и настроек,
  независимые запросы страниц и настроек выполняются параллельно.

## Модель данных (Rust, `core/model.rs`)
Отдельного `struct Task` нет: задача — это `Block`, у которого `is_task()`
(статус, приоритет, urgency/importance или `deadline`/`scheduled`).

```rust
struct Page { name: String, kind: PageKind,      // Journal | Page
    roots: Vec<Uuid>, order: Vec<Uuid>,
    preamble: Vec<String>,                       // строки до первого блока
    trailing_blank: u16, ends_with_newline: bool,
    mtime: Option<SystemTime>, content_hash: u64, path: Option<PathBuf> }
struct Block {
    id: Option<Uuid>,            // свойство `id::`, присваивается лениво
    indent: u8,
    status: Option<Status>,      // Later|Todo|Doing|Review|Done|Canceled
    priority: Option<Priority>,  // A | B | C  (как в Logseq)
    content: String,             // текст без маркера/приоритета
    props: HashMap<String,String>,
    urgency: Option<Level>,      // Low | Medium | High
    importance: Option<Level>,   // фолбэк на priority ([#A]=high, [#B]=medium)
    logbook: Vec<Clock>,         // `CLOCK: [from]--[to] => H:MM:SS`
    links: Vec<LinkTarget>,      // Page | Tag | Block((uuid), только чтение)
    children: Vec<Uuid>, parent: Option<Uuid>,
    raw: BlockRaw,               // сырые фрагменты для round-trip
}
enum LinkTarget { Page(String) | Tag(String) | Block(String) | Asset(String) }
```
Backlinks — обратный индекс `page-name → ссылающиеся блоки` (поле
`Graph.backlinks`), считается в ядре, выдаётся командой `backlinks_get`,
рендерится мгновенно. `Asset` участвует только в визуальном графе и не меняет
backlinks или round-trip.

## IPC (Tauri commands, см. `lib.rs`)
- Чтение: `graph_load`, `graph_summary`, `journal_list`, `journal_prev`,
  `page_get`, `page_list`, `follow_link`, `search`, `backlinks_get`
- Визуальный граф: `visual_graph_snapshot`, `visual_graph_local`,
  `visual_graph_path`, `visual_graph_layout_get`, `visual_graph_layout_save`,
  `asset_open`, `asset_reveal`, `asset_save`, `clipboard_asset_save`
  (DOM- и нативный clipboard в `assets/`)
- Списки задач: `kanban`, `tasks_by_query`, `matrix`
- Сохранённые запросы: `queries_list`, `queries_save`, `import_logseq_queries`
- Правки: `task_set_status`, `task_set_quadrant`, `task_set_priority`,
  `block_update_text`, `block_delete`, `block_create` (при добавлении первой
  записи создаёт отсутствующую обычную страницу), `block_set_prop`
- CLOCK: `clock_start`, `clock_stop`
- Интеграции: `integrations_states`, `integrations_set_secret`,
  `integrations_test`, `integrations_sync`
- Настройки/прочее: `settings_get`, `settings_save`, `recent_graphs`,
  `pick_graph_dir`, `global_shortcuts_status`, `niri_shortcuts_write`, `ping`
- Событие: `graph-changed` (payload `GraphSummary` — счётчики
  pages/journals/blocks/tasks/backlinks + root); эмитится после любой
  переиндексации (watcher и команды записи). Прогресс синка —
  события `sync-started` / `sync-finished`.

## Глобальные сочетания Wayland

Модуль `shortcuts/` выбирает backend по окружению рабочего стола. KDE,
GNOME 48+ и Hyprland используют XDG GlobalShortcuts portal: при первом запуске
`BindShortcuts` регистрирует `open`, `today`, `new-task`, при следующих
`ListShortcuts` восстанавливает полный набор без повторного Bind. Если любого
из обязательных id нет, выполняется Bind с полным набором. `Activated`
передаёт действие в общую с треем очередь, `Deactivated` игнорируется.

Sway управляется через `swaymsg`: перед `bindsym` читается текущий конфиг,
чужая привязка не перезаписывается; при штатном выходе снимаются только точные
неизменённые привязки Logtask. Для Niri кнопка в настройках создаёт только
`~/.config/niri/logtask.kdl`; основной `config.kdl` приложение не изменяет,
строку `include "logtask.kdl"` добавляет пользователь.

Sway и Niri вызывают `logtask --shortcut open|today|new-task`. CLI отправляет
JSON в Unix socket `$XDG_RUNTIME_DIR/logtask.sock` уже запущенного приложения,
не создавая второе GUI-окно. Socket имеет права 0600, проверяются peer
credentials, размер запроса ограничен 4 КиБ, таймаут — 2 с. Stale socket
удаляется только после неудачного connect. Ошибка любого backend логируется
и отображается в настройках, но не препятствует запуску Logtask. Root и
`/dev/input` не используются.

## Файлы состояния приложения
- `<граф>/.logtask/settings.json` — настройки графа (`settings.rs`):
  `theme` (dark|light), `fontScale` (0.85…1.4), `weekStart` (0|1),
  `kanbanLimit`, `statuses` (маркер/label/цвет/visible/shortcut, порядок
  канбана), `graphView` (фильтры, цветовые группы, отображение, физика и
  локальная глубина визуального графа).
- `<граф>/.logtask/graph-layout.json` — производные координаты и фиксация
  узлов визуального графа, независимые scope для global/local.
- `<граф>/.logtask/queries.json` — сохранённые запросы (вкладка «Запросы»).
- `<граф>/.logtask/integrations-state.json` — состояние синхронизации
  интеграций (последний синк/ошибка по источникам, отпечатки задач).
- `~/.config/logtask/recent.json` — список недавних графов.
- `~/.config/logtask/logs/` — логи (tauri-plugin-log).

## Производительность (бюджеты)
- старт → интерактивное окно: **<300 мс**
- построение индекса: **<100 мс** на текущем графе (release-замер 50 мс;
  debug — 218 мс, поэтому dev-режим заметно медленнее)
- набор текста: без IPC — `<textarea>`, запись по Enter/blur
- лента журнала: подгрузка предыдущих дней по 5 за раз
- переключение статуса/перетаскивание в матрице: одна IPC-команда —
  перезапись страницы + полная переиндексация графа (~72 мс на текущем
  графе), UI обновляется по `graph-changed`
- визуальный граф: до 1 000 узлов TTI ≤2 с, повторное открытие ≤300 мс;
  на 10 000 узлов / 25 000 рёбер UI остаётся отзывчивым. Замер на текущей
  машине: первый интерактивный кадр 1,19 с, повторный 147 мс, p95 frame time
  16,8 мс; проекция + BFS в Rust 133 мс release (`examples/bench_visual_graph.rs`).
  Отдельный production-замер на 455 узлах / 469 рёбрах с mock IPC: первый кадр
  158 мс вместо 224 мс до оптимизации, повторный — 46 мс вместо 78 мс;
  сохранённая раскладка даёт один кадр вместо 34 обновлений за ~1,2 с.
  Машина замера: x86_64, AMD Ryzen 5 5560U, 12 потоков. UI-benchmark
  воспроизводится через `npm run dev` и страницу `/bench/visual-graph.html`;
  IPC заменён детерминированной fixture, остальные компоненты настоящие.
  Нативный release-замер на реальном графе (`npm run app:build`, бинарник
  `target/release/logtask`): окно — 238 мс, открытие графа после клика —
  60 мс, повторное — 54 мс после вычета стоимости скриншота (~600 мс);
  разница кадров сохранённой раскладки за 400 мс — 0,0.
- Отображение интерполирует позиции узлов и камеру по времени кадра, отдельно
  от тиков Worker; drag и `prefers-reduced-motion` остаются мгновенными.
  Геометрия собирается в переиспользуемые typed arrays, цвета кэшируются,
  пакет физики выполняет детерминированные 2 тика. Детализация круга —
  16 или 64 сегмента по экранному радиусу; D3-столкновения на больших графах
  выполняются за один проход с сохранением финальной точной разводки.
  Browser tracing на 10 000 узлах / 25 000 рёбрах после hub-раскладки:
  p95 frame time 300,0 → 50,1 мс, p99 333,4 → 83,3 мс, первый интерактивный
  кадр 3973 → 1103 мс; время Worker в сценарии 10,9 → 3,2 с.
- Последующая оптимизация drag: события указателя объединяются по кадру,
  активная alpha не сбрасывается, collision workspace и ids переиспользуются,
  settled-значения не интерполируются повторно. Узлы, линии, стрелки и петли
  выводятся через WebGL2 instancing с отдельными RGBA-буферами; подписи
  растеризуются в texture atlas только при смене текста/стиля, с Canvas 2D
  fallback. Это не меняет силы, геометрию, поведение и настройки сцены.
- Замеры на этой же машине (AMD Ryzen 5 5560U, 12 потоков): 700 узлов / 1400
  связей / 120 перемещений — CPU Worker 1564 → 880 мс, positions-кадры 243 →
  129. Команда: `node --conditions=browser bench/drag-layout.mjs --nodes=700
  --drag=120`; эталон без scheduler — флаг `--unscheduled`.
  На 10 000 узлов / 25 000 связей p95 при drag снизился со 100–133 до 23,2 мс.
  На реальном графе (452 страницы) focused drag в release: CPU 46,4% → 16,7%
  (−64%). Browser benchmark выводит p95 и число positions-кадров Worker.
  Значения зависят от GPU/драйвера и не являются обещанием для другого железа.

## Что сознательно не делаем (v1)
- плагины (всё настраивается в `settings.json`)
- block refs `((uuid))` — парсинг и индексация есть, рендер-превью текста
  и создание — фаза 7
- whiteboards, PDF, flashcards
- встроенная синхронизация графа между устройствами (используйте Syncthing;
  синхронизация задач с внешними API — см. docs/05-integrations.md)
