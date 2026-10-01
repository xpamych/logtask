# AGENTS.md — Logtask

Файл для AI-агентов, работающих с этим репозиторием. Основной язык проекта
(комментарии, документация, коммиты) — русский.

## Обзор проекта

Logtask — десктоп-приложение: лёгкая замена Logseq для ведения журнала по дням
и управления задачами напрямую над папкой `.md`-файлов (формат Logseq).
Без Electron, без SQLite: **md-файлы — единственный источник истины**, индекс
графа живёт только в оперативной памяти.

Целевые характеристики: старт <300 мс, построение индекса <100 мс на текущем
графе пользователя (706 файлов, ~72 мс по замеру в `src-tauri/examples/bench_graph.rs`).
Переключение статуса/перетаскивание: цикл записи ~72 мс (перезапись страницы +
полная переиндексация графа; изначальная цель <16 мс не достигнута).

Ключевой контракт: **совместимость формата с Logseq**. Всё, что Logtask пишет
в `.md`, должно открываться в Logseq как родное, и наоборот. Контракт зафиксирован
в `docs/02-format.md` — это главный артефакт проекта.

## Стек и архитектура

Три слоя (см. `docs/01-architecture.md`):

1. **Ядро (Rust)** — `src-tauri/src/core/`: чистая логика, всё покрывается
   unit-тестами.
   - `parser.rs` — парсер Logseq-совместимого outliner-markdown (bullet-блоки,
     отступы tab/2+ пробелов, маркеры статусов, приоритеты `[#A..C]`, свойства
     `key:: value`, `:LOGBOOK:` + `CLOCK:`, `[[вики-ссылки]]`, `#теги`).
   - `model.rs` — `Page`, `Block`, `LinkTarget`, `Graph`, `Status`, `Priority`,
     `Level`, `Quadrant` (отдельного `struct Task` нет: задача — это `Block`
     с `is_task()`).
   - `index.rs` — in-memory индекс: страницы, теги, обратные ссылки, поиск.
   - `query.rs` — фильтры и сортировки для канбана/матрицы/запросов.
   - `serializer.rs` — round-trip сериализация (parse → serialize = те же байты).
   - `fswrite.rs` — запись в файлы: атомарная (tmp + fsync + rename); страница
     перезаписывается целиком (round-trip сериализация сохраняет остальное
     байт-в-байт); перед записью сверяется mtime (защита от конфликтов
     с Syncthing).
2. **Хост-приложение (Tauri 2)** — `src-tauri/src/`:
   - `commands.rs` — все IPC-команды (`tauri::generate_handler!` в `lib.rs`).
   - `watcher.rs` — `notify`-watcher за `journals/` и `pages/`: внешние
     изменения → переиндексация → событие `graph-changed` во фронтенд.
     События доступа фильтруются, коалесцируются окном тишины 350 мс.
   - `settings.rs` — настройки графа в `.logtask/settings.json`.
   - `config_edn.rs` — одноразовый импорт `:default-queries` из
     `logseq/config.edn`.
   - `recent.rs` — список недавних графов; `state.rs` — `AppState`
     (`RwLock<Option<Graph>>`).
3. **Интерфейс (SolidJS + TypeScript + Vite)** — `src/`:
   - `App.tsx` — корневой layout: сайдбар, центр (лента журнала или страница),
     правая панель (Канбан / Матрица / Запросы).
   - `components/` — `JournalTape`, `PageView`, `BlockView` (textarea
     редактирование блоков), `Kanban`, `Matrix`, `Queries`, `QueryEditor`,
     `Sidebar`, `SettingsModal`, `TaskCard`.
   - `lib/api.ts` — типизированные обёртки над `invoke()` для каждой
     IPC-команды. Новую команду добавляй и туда.
   - Стили — один файл `public/styles/global.css` с CSS-переменными и темами
     (`body.theme-dark` / `body.theme-light`).

IPC: фронтенд ↔ Rust через Tauri commands (serde); Rust → фронтенд — событие
`graph-changed` (слушается в `App.tsx` через `@tauri-apps/api/event`).

## Структура репозитория

```
Cargo.toml            — Rust workspace (единственный member: src-tauri)
package.json          — фронтенд-скрипты и зависимости
vite.config.ts        — Vite: solid-плагин, алиас "~" → src, порт 5173
tsconfig.json         — strict TS, jsxImportSource: solid-js
index.html            — точка входа Vite (подключает /styles/global.css)
src/                  — фронтенд SolidJS
public/styles/        — global.css (копируется в dist как есть)
docs/                 — архитектура (01), формат md (02), UI (03), роадмап (04)
src-tauri/            — Rust-крейт logtask (lib: logtask_lib, bin: main.rs)
  src/core/           — ядро (парсер/модель/индекс/query/сериализация/запись)
  tests/              — интеграционные тесты + fixtures/graph (реальные файлы)
  examples/bench_graph.rs — бенчмарк индексации реального графа
  capabilities/default.json — разрешения Tauri (без fs-плагина: core:default,
                        окно main, dialog:allow-open)
  tauri.conf.json     — окно 1280x800, identifier ru.logtask.app,
                        бандлы: appimage/rpm/deb
scripts/make_icons.py — генератор PNG-иконок (нужен pillow)
```

## Команды сборки и запуска



```bash
npm install              # фронтенд-зависимости
npm run app:dev          # tauri dev: поднимает Vite и открывает окно приложения
npm run app:build        # tauri build: npm run build + сборка бандлов
                         # (AppImage/rpm/deb в target/release/bundle)
npm run dev              # только Vite dev-сервер (без окна Tauri)
npm run build            # tsc --noEmit && vite build → dist/
```

Rust собирается из корня (workspace) или из `src-tauri/`:

```bash
cargo build --workspace
cargo run --example bench_graph   # бенчмарк индекса (путь к графу захардкожен
                                  # в examples/bench_graph.rs — поправь под себя)
```

## Тестирование

Все тесты — Rust, запуск из корня репозитория:

```bash
cargo test --workspace
```

Что где лежит:
- Unit-тесты ядра — в `src-tauri/src/core.rs` (`#[cfg(test)] mod tests`) и
  внутри модулей core.
- Интеграционные тесты — `src-tauri/tests/`:
  - `roundtrip.rs` — parse → serialize даёт байт-в-байт исходник для фикстур
    из `tests/fixtures/graph/` (реальные файлы графа пользователя, включая
    кириллицу и пробелы в именах). **Round-trip — критичное требование**:
    любые изменения парсера/сериализатора не должны его ломать.
  - `index.rs`, `task_status.rs` — индекс и статусы задач.
  - `import_real.rs`, `status_real.rs`, `matrix_real.rs` — тесты на реальном
    графе пользователя (путь захардкожен `/path/to/graph`);
    на другой машине эти тесты пропусти или поправь путь.

У фронтенда тестов нет. Проверка фронтенда — типизация: `npm run typecheck`
(запускается и внутри `npm run build`).

## Соглашения по коду

- **Язык**: комментарии, документация, строки UI и сообщения коммитов — на
  русском. Коммиты в формате «Фаза N: описание» (см. `git log`).
- **Rust**: edition 2021, rust-version 1.77. CI-примитивы по роадмапу:
  `cargo fmt --check` и `clippy -D warnings` — перед коммитом прогоняй
  `cargo fmt` и `cargo clippy`. Ошибки команд возвращаются как
  `Result<T, String>` для IPC. Мьютексы — `parking_lot::RwLock`.
- **TypeScript**: strict (`strict`, `noUnusedLocals`, `noUnusedParameters`,
  `verbatimModuleSyntax`). Импорты через алиас `~/*` → `src/*`.
  SolidJS-идиомы: `createSignal`/`createEffect`, `<For>`/`<Show>`,
  без Virtual DOM. Обработчики — `onClick` (не `on:click`).
- **Стили**: только `public/styles/global.css`, классы без CSS-in-JS;
  цвета и размеры — через CSS-переменные, чтобы работали обе темы.
- **Новая IPC-команда** — три точки изменения: функция в `src-tauri/src/commands.rs`
  + регистрация в `invoke_handler!` в `lib.rs` + типизированная обёртка в
  `src/lib/api.ts` (имена и типы DTO должны совпадать по serde).

## Правила работы с md-файлами (важно, docs/02-format.md)

- md-файлы — единственный источник истины; никакой БД/кэша на диске не плодить.
- Запись: страница сериализуется и перезаписывается целиком, атомарно
  (tmp + fsync + rename); round-trip сохраняет нетронутое байт-в-байт;
  перед записью сверять mtime с прочитанным.
- Статусы — маркеры блока как у Logseq: `LATER`/`TODO`/`DOING`/`REVIEW`/`DONE`/`CANCELED`.
- Срочность/важность — свойства `urgency::` / `importance::` (low/medium/high);
  приоритет `[#A]` мапится на важность high, `[#B]` — medium.
- Новые блоки писать с отступом tab (как Logseq); prop/clock-строки — с
  отступом «отступ блока + 2 пробела» (как Logseq). При чтении
  поддерживаются tab и 2+ пробела.
- Имя файла страницы: `pages/<title>.md`, кириллица/пробелы — как есть.
  Маппинг `/` → `___` пока не поддерживается (namespaced-страницы
  показываются как `Foo___Bar`).
- **Ничего не писать** в `logseq/` графа пользователя, не трогать `.transit`
  и SQLite Logseq. Свои настройки — только в `.logtask/settings.json`.

## Безопасность

- Разрешения Tauri — `src-tauri/capabilities/default.json`: только
  `core:default`, `core:window:allow-show`, `core:window:allow-set-title`,
  `dialog:allow-open`; окно одно (`main`). fs-плагин удалён: файловый
  доступ идёт только через Rust-ядро (sandbox-границ у fs нет), поэтому
  при добавлении команд/плагинов обновляй capabilities и не разрешай
  шире необходимого.
- CSP в `tauri.conf.json` отключён (`"csp": null`) — поэтому никакого
  `innerHTML`/инъекций HTML из пользовательского контента. Сейчас рендер
  ссылок и тегов идёт через JSX-сегменты (`src/lib/text.ts`, `parseSegments`),
  а редактирование — через `<textarea>` (`BlockView`), т.е. пользовательский
  текст нигде не интерпретируется как HTML. Сохраняй это свойство.
- Секретов в проекте нет; путь к графу и настройки хранятся у пользователя.

## Документация

Перед изменениями читай соответствующий файл в `docs/`:
1. `docs/01-architecture.md` — слои, модель данных, IPC, бюджеты производительности
2. `docs/02-format.md` — контракт md-формата (главный!)
3. `docs/03-ui.md` — виды, шорткаты, темы
4. `docs/04-roadmap.md` — поэтапный план (фазы 0–6 завершены, фаза 7 — backlog)

Если изменение затрагивает описанное в docs/ поведение — обнови docs/ в том же
коммите.
