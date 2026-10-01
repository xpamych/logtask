# Архитектура

## Стек
- **Ядро (Rust, крейт `logtask`, lib `logtask_lib`, модуль `core`)**: парсер
  outliner-формата, модель данных, индекс графа, query-движок, запись.
  Чистая логика, всё тестируется unit-тестами.
- **Хост-приложение (Tauri 2, `src-tauri`)**: создание окна, IPC-команды,
  файловый watcher, логирование. webkit2gtk-4.1 (уже установлен).
  Tray и глобальные хоткеи не реализованы — фаза 7.
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
- Команды записи сами переиндексируют затронутую страницу и эмитят
  `graph-changed`; эхо собственных записей в watcher подавляется окном
  1.5 с (`last_self_write`).
- Никакой БД на диске не нужна. Кэш на диск (опционально, для графов от
  10 000 файлов) — фаза 7.

## Модель данных (Rust, `core/model.rs`)
Отдельного `struct Task` нет: задача — это `Block`, у которого `is_task()`
(статус, приоритет, urgency/importance или `deadline`/`scheduled`).

```rust
struct Page { name: String, kind: PageKind,      // Journal | Page
    roots: Vec<Uuid>, order: Vec<Uuid>,
    preamble: Vec<String>,                       // строки до первого блока
    trailing_blank: u16, ends_with_newline: bool,
    mtime: Option<SystemTime>, path: Option<PathBuf> }
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
enum LinkTarget { Page(String) | Tag(String) | Block(String) }
```
Backlinks — обратный индекс `page-name → ссылающиеся блоки` (поле
`Graph.backlinks`), считается в ядре, выдаётся командой `backlinks_get`,
рендерится мгновенно.

## IPC (Tauri commands, см. `lib.rs`)
- Чтение: `graph_load`, `graph_summary`, `journal_list`, `journal_prev`,
  `page_get`, `page_list`, `follow_link`, `search`, `backlinks_get`
- Списки задач: `kanban`, `tasks_by_filter`, `matrix`
- Сохранённые запросы: `queries_list`, `queries_save`, `import_logseq_queries`
- Правки: `task_set_status`, `task_set_quadrant`, `task_set_priority`,
  `block_update_text`, `block_delete`, `block_create`, `block_set_prop`
- CLOCK: `clock_start`, `clock_stop`
- Настройки/прочее: `settings_get`, `settings_save`, `recent_graphs`,
  `pick_graph_dir`, `ping`
- Событие: `graph-changed` (payload `GraphSummary` — счётчики
  pages/journals/blocks/tasks/backlinks + root); эмитится после любой
  переиндексации (watcher и команды записи).

## Файлы состояния приложения
- `<граф>/.logtask/settings.json` — настройки графа (`settings.rs`):
  `theme` (dark|light), `fontScale` (0.85…1.4), `weekStart` (0|1),
  `kanbanLimit`, `statuses` (маркер/label/цвет/visible/shortcut, порядок
  канбана).
- `<граф>/.logtask/queries.json` — сохранённые запросы (вкладка «Запросы»).
- `~/.config/logtask/recent.json` — список недавних графов.
- `~/.config/logtask/logs/` — логи (tauri-plugin-log).

## Производительность (бюджеты)
- старт → интерактивное окно: **<300 мс**
- построение индекса: **<100 мс** на текущем графе (замер 72 мс)
- набор текста: без IPC — `<textarea>`, запись по Enter/blur
- лента журнала: подгрузка предыдущих дней по 5 за раз
- переключение статуса/перетаскивание в матрице: <16 мс (перезапись
  страницы + переиндексация одной страницы)

## Что сознательно не делаем (v1)
- плагины (всё настраивается в `settings.json`)
- block refs `((uuid))` — парсинг и индексация есть, рендер-превью текста
  и создание — фаза 7
- tray, глобальные горячие клавиши — фаза 7
- whiteboards, PDF, flashcards
- встроенная синхронизация
