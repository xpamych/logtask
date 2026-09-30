# Архитектура

## Стек
- **Ядро (Rust, крейт `logtask-core`)**: парсер outliner-формата, модель данных,
  индекс графа, query-движок, файловый watcher, запись. Чистая логика, всё
  тестируется unit-тестами.
- **Хост-приложение (Tauri 2, `src-tauri`)**: создание окна, IPC-команды,
  системные горячие клавиши, tray,.webkit2gtk-4.1 (уже установлен).
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
logtask-core::index —— in-memory граф (блоки, страницы, теги, ссылки)
        ▲                         │
        │ notify (inotify)         │ IPC (serde)
        │ внешние изменения        ▼
src-tauri (команды) ←————→ SolidJS UI
```
- На старте индекс строится полным проходом по `journals/` и `pages/`
  (700 файлов / 7 МБ — фон, бюджет <100 мс).
- `notify` следит за изменениями снаружи (Syncthing, ручное редактирование):
  перепарсится только изменённый файл, индекс обновляется инкрементально.
- Никакой БД на диске не нужна. Кэш на диск (опционально) — только как
  ускоритель для графов от 10 000 файлов (фаза 5).

## Модель данных (Rust)
```rust
struct Page { id: PageId, name: String, kind: PageKind, // Journal | Page
    blocks: Vec<Block>, mtime, created_at }
struct Block {
    block_id: Uuid,            // свойство `id::`, присваивается лениво
    parent_id: Option<Uuid>,   // по отступам
    content: String,           // текст без маркера/приоритета
    props: HashMap<String,String>,
    logbook: Vec<Clock>,       // `CLOCK: [from]--[to] => H:MM:SS`
    indent: u8,
}
struct Task {                  // Block, который стал задачей
    status: Status,            // Backlog | Todo | Doing | Waiting | Done | Canceled
    priority: Priority,        // A | B | C  (как в Logseq)
    urgency: Level,            // Low | High  — срочность
    importance: Level,         // Low | High  — важность (фолбэк на priority)
    deadline: Option<Date>, scheduled: Option<Date>,
    tags: Vec<String>,
    done_at: Option<DateTime>,
}
struct Link { from: PageId|Block, to: PageId, // [[вики-ссылка]] | #тег | ((block-ref))
}
```
Backlinks — обратный индекс `to -> [ссылающиеся блоки]`, считается в ядре,
выдаётся одной IPC-командой, рендерится мгновенно.

## IPC (Tauri commands)
- `graph_load(path?) -> GraphSummary`
- `journal_day(date) -> Page` / `journal_prev(date, n)` — лента по датам
- `page_get(name) -> Page`, `page_upsert`
- `task_upsert(id, patch)` / `task_move(id, {status|urgency|importance})`
- `query_run(QuerySpec) -> Vec<Task>` — кастомный список задач
- `backlinks_get(page) -> Vec<RefBlock>`
- `search(query)` — мгновенный поиск по блокам
- события: `files_changed`, `task_changed`

## Производительность (бюджеты)
- старт → интерактивное окно: **<300 мс**
- построение индекса: **<100 мс** на текущем графе, <1 с на 10 000 файлов
- набор текста: без IPC — `contenteditable`, сохранение дебаунсится в ядре
- лента журнала: виртуальный скролл, DOM только у видимых блоков
- переключение статуса/перетаскивание в матрице: <16 мс (однаprops-запись)

## Что сознательно не делаем (v1)
- плагины (всё настраивается в `settings.json`)
- block-embeds `((uuid))` — только чтение, без создания
- whiteboards, PDF, flashcards
- встроенная синхронизация
