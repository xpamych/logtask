# Comprehensive Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Последовательно устранить все подтверждённые результаты аудита без потери Markdown-данных и с отдельным коммитом на каждую проблему.

**Architecture:** Сначала устраняются destructive-сценарии синхронизации и гонки состояния, затем файловые операции и IPC, после этого frontend и инфраструктура. Каждая задача добавляет узкий регрессионный тест и сохраняет существующие Rust/SolidJS-идиомы.

**Tech Stack:** Rust 2021, Tauri 2, reqwest/rustls, wiremock, SolidJS, TypeScript, Node test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-11-03-comprehensive-audit-fixes-design.md`

## Global Constraints

- md-файлы — единственный источник истины; round-trip нетронутого содержимого обязателен.
- Не изменять Markdown-формат, Tauri capabilities и public UI-строки без необходимости.
- Не добавлять новые зависимости, если достаточно текущего стека.
- Комментарии, UI, документация и коммиты — на русском; коммиты оформляются по проектному шаблону.
- Перед каждым коммитом профильные тесты и линтеры зелёные; после задач 1–7 также полный Rust suite, после 8–12 полный frontend suite.
- Работа выполняется только в `/home/xpamych/Projects/logtask/.worktrees/fix-comprehensive-audit`.

## Review Focus

- API возвращает полную страницу, а затем ошибку/пустую страницу: merge обязан видеть либо полный набор, либо не выполняться (задача 1, тест ошибки второй страницы).
- Добавление импортированной задачи падает после создания блока, но до записи `source-id`: на диске не должно быть неидентифицированного блока (задача 2, одна запись страницы).
- Во время fetch/save пользователь открывает другой граф: старый sync не должен использовать новый graph со старым root (задача 3, epoch).
- Внешний редактор меняет байты, сохраняя mtime: watcher обязан переиндексировать файл (задача 7, content hash).
- HTTP-сервер использует chunked-body, неверный Content-Length или redirect: чтение ограничено фактическими байтами и итоговой схемой (задача 12).

---

### Task 0: Зелёная база clippy

**Files:**
- Modify: `src-tauri/src/settings.rs:329`

**Interfaces:**
- Produces: тест `graph_view_settings_roundtrip_preserves_groups_and_physics` инициализирует `Settings` одним struct literal; поведение не меняется.

- [ ] **Step 1: Подтвердить исходное предупреждение**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: FAIL на `field_reassign_with_default` в `settings.rs:330`.

- [ ] **Step 2: Заменить последовательные присваивания на struct literal**

Сохранить все значения теста и `..Default::default()` для остальных полей.

- [ ] **Step 3: Прогнать проверки**

Run: `cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
Expected: PASS.

- [ ] **Step 4: Коммит**

`Исправлено предупреждение статического анализа в тесте настроек`.

### Task 1: Полная и безопасная пагинация форжей

**Files:**
- Modify: `src-tauri/src/sync/forge.rs`
- Modify: `src-tauri/src/sync/http.rs`
- Test: `src-tauri/src/sync/forge.rs` (`#[cfg(test)]`)
- Docs: `docs/05-integrations.md`

**Interfaces:**
- Produces: `async fn fetch_array_pages(client: &reqwest::Client, url: &str, headers: &[(String, String)], page_size: usize) -> Result<Vec<serde_json::Value>, String>`; URL получает `page=N`, чтение заканчивается на сырой странице короче `page_size`.
- Produces: `async fn get_json_optional(...) -> Result<Option<serde_json::Value>, String>`; `Ok(None)` только для HTTP 404, остальные ошибки остаются ошибками.

- [ ] **Step 1: Добавить failing wiremock-тесты**

Тесты: `issues_fetch_all_pages`, `owner_repos_fetch_all_pages`, `second_page_error_aborts_fetch`, `owner_fallback_only_on_initial_404`, `github_pagination_counts_raw_page_before_pr_filter`. Два набора по 100/101 элементов достаточно; assertions проверяют все id, число запросов и ошибку без частичного `Vec`.

- [ ] **Step 2: Запустить тесты и подтвердить исходный дефект**

Run: `cargo test sync::forge::tests -- --nocapture`
Expected: новые тесты FAIL: возвращается только первая страница либо выполняется недопустимый fallback.

- [ ] **Step 3: Реализовать общую пагинацию и ограниченный fallback**

Добавить helper в `forge.rs`, использовать его для issues и owner repos во всех трёх адаптерах. `get_json_optional` применять только к первому org-запросу; последующие страницы и user-запросы используют строгое чтение. Стабильно дедуплицировать repo names. Обновить документацию: читаются все страницы, ошибка любой отменяет sync.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test sync::forge::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: все существующие и новые тесты PASS; clippy без ошибок.

- [ ] **Step 5: Коммит**

`Исправлена неполная загрузка задач из внешних источников` + блоки «Исправлено» о пагинации и запрете удаления по неполным данным.

### Task 2: Атомарное добавление и честные ошибки sync/state

**Files:**
- Modify: `src-tauri/src/core/index.rs`
- Modify: `src-tauri/src/sync/mod.rs`
- Modify: `src-tauri/src/sync/state.rs`
- Test: `src-tauri/src/sync/mod.rs`, `src-tauri/tests/task_status.rs`

**Interfaces:**
- Produces: `Graph::append_block_with<F>(..., status: Option<Status>, root: &Path, configure: F) -> std::io::Result<Option<Uuid>> where F: FnOnce(&mut Block)`; одна сериализация/запись.
- Produces: `MergeSummary { completed: HashSet<String> }`; `refresh_task_states(..., completed: &HashSet<String>)` обновляет только завершённые id.
- Produces: `sync::state::state_lock() -> &'static std::sync::Mutex<()>` для read-modify-write state всех источников, включая `record_error`.

- [ ] **Step 1: Добавить failing-тесты**

`imported_task_is_written_with_source_atomically`, `failed_add_does_not_increment_or_duplicate`, `failed_remove_keeps_task_state`, `mark_missing_error_sets_report_and_blocks_last_sync`, `concurrent_sources_preserve_both_states`, `state_save_error_is_reported`. Для сбоя использовать mtime-конфликт/тестовый writer, а не права root.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test sync::tests -- --nocapture`
Expected: текущая реализация даёт ложные счётчики/state либо не имеет API одной записи.

- [ ] **Step 3: Реализовать одну запись и propagation ошибок**

Старый `append_block` делегирует `append_block_with` с no-op. `add_task` настраивает блок до записи. Все merge-операции возвращают/обрабатывают `Result`; `completed` включает успешные и Keep. Merge-ошибка запрещает продвижение `last_sync`. State перечитывается под общей блокировкой, заменяется только текущий source, ошибка save попадает в отчёт.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test sync::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS без дублей и потери состояния источников.

- [ ] **Step 5: Коммит**

`Исправлена потеря данных при ошибках синхронизации` + атомарное добавление, честные ошибки, сохранение state.

### Task 3: Epoch графа для ручной и фоновой синхронизации

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/sync/mod.rs`
- Modify: `src-tauri/src/watcher.rs`
- Test: `src-tauri/src/sync/mod.rs`

**Interfaces:**
- Produces: `AppState.graph_epoch: std::sync::atomic::AtomicU64`, `GraphContext { epoch: u64, root: PathBuf }`.
- Produces: `sync::current_context(state: &AppState) -> Option<GraphContext>`, `sync::context_is_current(state: &AppState, context: &GraphContext) -> bool`.
- Produces: `watcher::reindex_and_emit_if_current(app: &AppHandle, context: &GraphContext) -> bool`.

- [ ] **Step 1: Написать failing-тесты протокола**

`changed_epoch_cancels_after_fetch`, `close_cancels_before_state_save`, `same_epoch_allows_merge`. Тест имитирует A → B после fetch и проверяет отсутствие записи в B и отчёт об отмене.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test sync::tests::changed_epoch -- --nocapture`
Expected: текущий код не имеет epoch и не отменяет операцию.

- [ ] **Step 3: Реализовать epoch и проверки этапов**

`graph_load`/`graph_close` увеличивают epoch до смены состояния. Sync проверяет context под graph write перед merge, после каждого await перед state и перед reindex. Если load увеличил epoch и ждёт graph lock, sync завершает только согласованную старую пару graph/root и не начинает новых этапов.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test sync::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS; ручной sync защищён тем же протоколом.

- [ ] **Step 5: Коммит**

`Исправлена запись синхронизации после смены графа`.

### Task 4: Конфликтобезопасные rename/delete и code-aware замена

**Files:**
- Modify: `src-tauri/src/core/index.rs`
- Modify: `src-tauri/src/core/rename.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/page_rename.rs`, `src-tauri/src/core/rename.rs`

**Interfaces:**
- Produces: test-only/f internal `Graph::rename_page_with_writer` с writer, позволяющим упасть на заданном файле; production использует `atomic_write`.
- Produces: `replace_refs` сохраняет inline/fenced code и обычный текст вне ссылок.

- [ ] **Step 1: Добавить failing-тесты**

`rename_rejects_external_edit`, `rename_rolls_back_failed_file`, `failed_rollback_reports_inconsistent_files`, `rename_does_not_overwrite_newer_external_edit`, `refs_in_inline_and_fenced_code_unchanged`, `delete_rejects_external_edit`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test --test page_rename && cargo test core::rename::tests`
Expected: mtime/rollback/code-тесты падают.

- [ ] **Step 3: Реализовать preflight, per-file проверку и откат**

Снимки и mtime всех файлов вычисляются заранее; metadata error возвращает ошибку. Перед каждой записью mtime повторяется. Откат выполняется только поверх собственной записи, не поверх новой внешней правки. При любом исходе команда переиндексирует фактическое состояние; rollback-ошибка содержит список несогласованных файлов.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test --test page_rename && cargo test core::rename::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, round-trip тесты остаются зелёными.

- [ ] **Step 5: Коммит**

`Исправлена безопасность переименования и удаления страниц` + сохранение кода и внешних правок.

### Task 5: Write-back до смены UUID и актуальный UUID block_create

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `fn imported_push_info(block: &Block) -> Option<(String, String)>`, вызывается до `set_block_status`.
- Consumes: `reindexed_block_uuid(state, page, position)` для обоих IPC после финального reindex.

- [ ] **Step 1: Добавить failing-тесты**

`push_info_is_captured_before_reindex` доказывает, что source сохраняется до исчезновения старого id; `created_uuid_is_resolved_after_reindex` проверяет позицию нового блока в финальном graph.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test commands::tests::push_info -- --nocapture`
Expected: текущий порядок lookup даёт `None`.

- [ ] **Step 3: Изменить порядок IPC**

Захватить source до mutation; после reindex запускать standalone push и возвращать fresh UUID. В `block_create` сохранить позицию до reindex и разрешить UUID после него.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test commands::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Коммит**

`Исправлена мгновенная отправка статуса и идентификаторы новых блоков`.

### Task 6: Ошибки повреждённых JSON вместо silent default

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/sync/state.rs`
- Modify: call sites `src-tauri/src/commands.rs`, `src-tauri/src/sync/mod.rs`
- Test: `src-tauri/src/settings.rs`, `src-tauri/src/sync/state.rs`

**Interfaces:**
- Produces: `settings::load(root) -> Result<Settings, String>`, `sync::state::load(root) -> Result<SyncState, String>`; NotFound = default, invalid JSON = Err с путём.
- Produces: `record_error(...) -> Result<(), String>`; ошибки обрабатываются без повторной записи повреждённого файла.

- [ ] **Step 1: Добавить failing-тесты**

`invalid_settings_return_error_and_preserve_file`, `invalid_sync_state_aborts_load`, `missing_files_still_default`. Assert байты после вызова load/неудачного sync.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test settings::tests && cargo test sync::state::tests`
Expected: текущий `unwrap_or_default` возвращает default вместо ошибки.

- [ ] **Step 3: Обновить load и все call sites**

Не менять JSON-схему. Не запускать merge при invalid state; UI получает внятную ошибку. Автосохранение не вызывается для нечитаемого файла.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test settings::tests && cargo test sync::state::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Коммит**

`Исправлено молчаливое затирание повреждённых настроек и состояния`.

### Task 7: Watcher по путям и хэшу содержимого

**Files:**
- Modify: `src-tauri/src/core/model.rs`
- Modify: `src-tauri/src/core/index.rs`
- Modify: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/watcher.rs`, round-trip fixtures

**Interfaces:**
- Produces: `Page.content_hash: u64` (`#[serde(default, skip)]`), вычисляемый из исходного текста при индексации.
- Produces: `watcher::paths_need_reindex(graph: &Graph, root: &Path, paths: &HashSet<PathBuf>) -> bool`; фильтрует только собственные неизменённые `.md`-события.

- [ ] **Step 1: Добавить failing-тесты**

`external_change_during_self_write_is_not_suppressed`, `same_mtime_different_hash_requires_reindex`, `own_echo_is_skipped`, `rename_paths_and_missing_files_require_reindex`, `tmp_non_md_is_ignored`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test watcher::tests -- --nocapture`
Expected: глобальное окно и mtime-only логика не проходит сценарии.

- [ ] **Step 3: Реализовать path channel и content hash**

Коалесцировать `HashSet<PathBuf>`, учитывать оба rename path, игнорировать tmp/non-md. Убрать 1,5-секундное глобальное подавление; `last_self_write` удалить, если больше не используется. Хэш вычислять в core, не зависеть от `sync`.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test watcher::tests && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, round-trip не изменился.

- [ ] **Step 5: Коммит**

`Исправлено подавление внешних изменений файловым наблюдателем`.

### Task 8: Сохранение текста в autocomplete и настоящая новая задача

**Files:**
- Modify: `src/lib/text.ts`
- Modify: `src/components/BlockView.tsx`
- Modify: `src/components/JournalTape.tsx`
- Test: `src/lib/markdown.test.ts`, новый чистый helper при необходимости
- Docs: `docs/03-ui.md`

**Interfaces:**
- Produces: `completeWikiLink(text: string, name: string) -> { text: string; caret: number }`; сохраняет suffix и caret после `]]`.
- Produces: composer marker `TODO` только для `logtask:new-task`; обычный composer получает `null`.

- [ ] **Step 1: Добавить failing-тесты**

`complete_wiki_link_preserves_suffix_and_caret`, `complete_wiki_link_preserves_following_lines`, `new_task_command_uses_todo_but_plain_composer_does_not`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `node --conditions=browser --test src/lib/markdown.test.ts`
Expected: suffix теряется/команда не имеет маркера.

- [ ] **Step 3: Реализовать helper и marker composer**

`BlockView.acceptAutocomplete` использует helper. `JournalTape` хранит marker текущего composer и сбрасывает его после submit/close.

- [ ] **Step 4: Прогнать проверки**

Run: frontend test suite и `npm run build`
Expected: все Node-тесты и typecheck PASS.

- [ ] **Step 5: Коммит**

`Исправлены вставка ссылок и создание задачи по горячей клавише`.

### Task 9: Очередь настроек по графу и epoch PageView

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/components/PageView.tsx`
- Modify: `src-tauri/src/commands.rs`
- Create: `src/lib/settingsQueue.ts`, `src/lib/settingsQueue.test.ts`
- Test: `src/lib/startup.test.ts` или новый page-load helper test

**Interfaces:**
- Produces: `settingsSave(settings: Settings, expectedRoot: string) -> Promise<void>`; Rust отклоняет несовпадающий root.
- Produces: очередь «one in-flight + latest pending» с sequence и graph key; pending старого графа отменяется.
- Produces: `PageView` epoch, отбрасывающий устаревшие page/backlinks/error.

- [ ] **Step 1: Добавить failing-тесты**

`settings_queue_serializes_requests`, `latest_pending_wins`, `old_graph_never_saves_into_new_graph`, `stale_page_response_and_error_are_ignored`, `settings_save_rejects_wrong_root`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `node --conditions=browser --test src/lib/settingsQueue.test.ts && cargo test commands::tests::settings_save_rejects_wrong_root`
Expected: API/защиты отсутствуют.

- [ ] **Step 3: Реализовать общую очередь и epoch**

Все прямые `settingsSave` в App перевести на неё. Открытие/закрытие графа меняет graph key и отменяет pending. Backend сравнивает expectedRoot с текущим. PageView увеличивает epoch на каждую загрузку.

- [ ] **Step 4: Прогнать проверки**

Run: frontend test suite, `npm run build`, `cargo test --workspace`, clippy
Expected: PASS.

- [ ] **Step 5: Коммит**

`Исправлены гонки сохранения настроек и загрузки страниц`.

### Task 10: Rename подборок, live backlinks и литеральный inline code

**Files:**
- Modify: `src/components/Queries.tsx`
- Modify: `src/components/QueryEditor.tsx`
- Modify: `src/components/JournalTape.tsx`
- Modify: `src/lib/text.ts`
- Create: `src/lib/queryState.ts`, `src/lib/queryState.test.ts`
- Test: `src/lib/markdown.test.ts`, `src/lib/journalRefresh.test.ts`

**Interfaces:**
- Produces: `upsertQuery(queries: SavedQuery[], query: SavedQuery, originalTitle: string | null) -> SavedQuery[]`.
- Produces: `BacklinksPanel` зависит от `name` и `refreshKey`.
- Produces: `parseInline` не создаёт сегменты ссылок/тегов/URL внутри backtick code.

- [ ] **Step 1: Добавить failing-тесты**

`renamed_query_replaces_original`, `backlinks_refresh_key_reloads`, `inline_code_keeps_links_tags_urls_literal`, `variable_backticks_and_fenced_code_are_literal`.

- [ ] **Step 2: Подтвердить FAIL**

Run: профильные Node-тесты
Expected: старое название остаётся/код размечается.

- [ ] **Step 3: Реализовать изменения**

QueryEditor передаёт исходное название; Queries использует helper. BacklinksPanel получает refreshKey. Сканер inline code обрабатывается до остальных tokens без поддержки HTML-инъекций.

- [ ] **Step 4: Прогнать проверки**

Run: frontend test suite и `npm run build`
Expected: PASS.

- [ ] **Step 5: Коммит**

`Исправлены подборки, обратные ссылки и отображение кодовых фрагментов`.

### Task 11: CLOCK в TaskCard

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/components/TaskCard.tsx`
- Test: `src-tauri/src/commands.rs`, `src/lib/taskMenuState.test.ts`

**Interfaces:**
- Produces: `TaskDto.clockRunning: boolean` / Rust `clock_running`.
- Produces: `TaskCard.onClockToggle`, использующий `clockStart`/`clockStop`, fresh UUID и `props.onChanged`.

- [ ] **Step 1: Добавить failing-тесты**

`task_dto_includes_clock_running`, `task_card_clock_toggle_updates_running_state`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test commands::tests::task_dto_includes_clock_running && node --conditions=browser --test src/lib/taskMenuState.test.ts`
Expected: поле/поведение отсутствует.

- [ ] **Step 3: Реализовать DTO и меню**

Передать `onClockToggle` и `clockRunning` в BlockMenu; ошибки логировать, состояние после успеха обновлять. Обновить `docs/03-ui.md`, если требуется уточнение.

- [ ] **Step 4: Прогнать проверки**

Run: полный Rust/frontend suites, `npm run build`, clippy
Expected: PASS.

- [ ] **Step 5: Коммит**

`Добавлено управление учётом времени из карточек задач`.

### Task 12: Лимиты HTTP и строгий atomic write

**Files:**
- Modify: `src-tauri/src/sync/http.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/core/fswrite.rs`
- Modify: `src-tauri/src/core.rs`
- Test: `src-tauri/src/sync/http.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/core.rs`

**Interfaces:**
- Produces: `http::read_body_limited(response: reqwest::Response, max_bytes: usize) -> Result<Vec<u8>, String>` на `chunk()`, с Content-Length precheck и фактическим лимитом.
- Produces: лимиты JSON 32 MiB, title 1 MiB, favicon 5 MiB, error body 64 KiB; title по-прежнему анализирует первые 256 KiB.
- Produces: HTTP(S)-валидация исходного и `response.url()` после redirects.
- Produces: internal atomic-write hooks для тестового сбоя permissions/fsync; production использует реальные операции.

- [ ] **Step 1: Добавить failing-тесты**

`chunked_body_over_limit_is_rejected`, `false_content_length_does_not_bypass_limit`, `redirect_final_scheme_is_validated`, `large_json_and_error_body_are_bounded`, `permission_sync_and_dir_sync_errors_propagate_and_clean_tmp`.

- [ ] **Step 2: Подтвердить FAIL**

Run: `cargo test sync::http::tests && cargo test commands::tests && cargo test core::tests::atomic_write`
Expected: текущее чтение целиком/игнорируемые ошибки не проходят.

- [ ] **Step 3: Реализовать ограниченное чтение и строгую запись**

Использовать `Response::chunk` без новой зависимости. Применить reader к JSON API, send_json errors, title/favicon. Permission error прекращает работу до rename; Unix parent fsync ошибка возвращается. Не менять атомарный tmp+rename протокол.

- [ ] **Step 4: Прогнать проверки**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: PASS, tmp-файлов нет.

- [ ] **Step 5: Коммит**

`Исправлены неограниченные сетевые ответы и скрытые ошибки записи`.

### Task 13: Зависимости и обязательные проверки CI

**Files:**
- Modify: `package-lock.json`, при необходимости `package.json`
- Create: `.gitea/workflows/check.yml`
- Modify: `.gitea/workflows/release.yml`

**Interfaces:**
- Produces: CI-команды `npm ci`, Node tests, `npm run build`, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` на push/PR/tag.

- [ ] **Step 1: Зафиксировать исходную уязвимость**

Run: `npm audit --omit=dev`
Expected: audit сообщает seroval advisories; clippy уже зелёный после задачи 0.

- [ ] **Step 2: Обновить зависимости**

Предпочтительно `npm update solid-js seroval --package-lock-only` в пределах semver; не менять major без отдельного обоснования.

- [ ] **Step 3: Добавить CI check и включить проверки release**

Ubuntu/system dependencies совпадают с release; Node/Rust устанавливаются тем же способом. Release вызывает те же команды до `app:build` либо зависит от check workflow, не дублируя несовместимую конфигурацию.

- [ ] **Step 4: Прогнать проверки**

Run: `npm ci`, frontend tests/build, `npm audit --omit=dev`, `cargo fmt --check`, clippy, `cargo test --workspace`
Expected: 0 audit vulnerabilities в production; все проверки PASS.

- [ ] **Step 5: Коммит**

`Добавлены обязательные проверки качества и обновлены зависимости`.

### Task 14: Синхронизация документации с фактическим поведением

**Files:**
- Modify: `AGENTS.md`, `README.md`
- Modify: `docs/01-architecture.md`, `docs/02-format.md`, `docs/03-ui.md`, `docs/04-roadmap.md`, `docs/05-integrations.md`

**Interfaces:**
- Produces: единая актуальная документация без новых runtime-интерфейсов.

- [ ] **Step 1: Сверить чек-лист расхождений**

Проверить capabilities, отсутствие фиксации WebKitGTK, расположение подборок, pagination/error semantics, rename/delete, новую задачу, CLOCK, watcher hash, HTTP limits и закрытый watcher backlog.

- [ ] **Step 2: Исправить документацию**

Не копировать исторические показатели как новые замеры. Зафиксировать best-effort rollback rename, отсутствие generic pagination и реальные CI-команды.

- [ ] **Step 3: Финальная проверка**

Run: `git diff --check`, полный Rust/frontend suites, `npm run build`, `npm audit --omit=dev`, `git status --short`
Expected: diff чист по whitespace, тесты PASS, после коммита рабочее дерево чистое.

- [ ] **Step 4: Коммит**

`Актуализирована документация после исправления результатов аудита`.

## Final Verification

- [ ] Все 15 коммитов (задачи 0–14) присутствуют в `git log`, каждый соответствует одной задаче.
- [ ] `cargo fmt --check`, clippy и `cargo test --workspace` завершаются успехом.
- [ ] Все frontend Node-тесты и `npm run build` завершаются успехом.
- [ ] `npm audit --omit=dev` сообщает 0 vulnerabilities либо оставшаяся проблема явно останавливает завершение.
- [ ] Нет `.logtask.tmp`, тестовых артефактов и незакоммиченных файлов; реальный граф пользователя не изменялся.
