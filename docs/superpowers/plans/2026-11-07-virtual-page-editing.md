# Virtual Page Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разрешить добавлять первую запись на виртуальной странице и автоматически создавать её md-файл при сохранении.

**Architecture:** SolidJS показывает для виртуальной страницы существующий composer пустой страницы. Rust перед `append_block` индексирует новую обычную страницу, файл которой создаётся эксклюзивно через существующий `Graph::create_page_file`.

**Tech Stack:** Rust, Tauri 2 IPC, SolidJS, TypeScript, интеграционные тесты Rust.

**Spec:** `docs/superpowers/specs/2026-11-07-virtual-page-editing-design.md`

## Global Constraints

- Файл создаётся только при сохранении непустой первой записи.
- Использовать Logseq-совместимый формат, атомарную запись и существующие IPC без новых зависимостей.
- Не перезаписывать файл, появившийся на диске между открытием виртуальной страницы и сохранением.

## Review Focus

- Имя с `/`, `\` или пустое: создание должно отклоняться существующей валидацией; тест `append_to_virtual_page_rejects_invalid_name` в задаче 1.
- Файл появился внешне: `create_new` должен вернуть `AlreadyExists`, содержимое не меняется; тест `append_to_virtual_page_does_not_overwrite_external_file` в задаче 1.
- Отмена/пустой composer: файл не создаётся, поскольку IPC не вызывается; проверка существующей ветки `submitComposer` в задаче 2.
- Журнал отсутствует: автоматическое создание разрешено только обычным страницам; тест `append_to_virtual_page_rejects_journal_name` в задаче 1.
- После создания возвращается UUID именно нового последнего блока; утверждения индекса и содержимого в задаче 1.

---

### Task 1: Создание первого блока виртуальной страницы

**Files:**
- Modify: `src-tauri/src/core/index.rs`
- Modify: `src-tauri/src/commands.rs:1329-1360`
- Test: `src-tauri/tests/page_create.rs`

**Interfaces:**
- Consumes: `Graph::create_page_file(name, root)`, `Graph::index_file_content(...)`, `Graph::append_block(...)`.
- Produces: `Graph::ensure_page(name: &str, root: &Path) -> std::io::Result<()>`, который создаёт и индексирует отсутствующую обычную страницу, а существующую оставляет без изменений.

- [ ] **Step 1: Write failing tests**
  Добавить тесты: отсутствующая страница после `ensure_page` + `append_block` содержит `- Первая запись`; существующая страница не создаётся повторно; внешний файл не перезаписывается; пустые имена, разделители и имя формата `YYYY_MM_DD` отклоняются.
- [ ] **Step 2: Run tests to verify they fail**
  Run: `cargo test --test page_create`
  Expected: FAIL из-за отсутствия `Graph::ensure_page`.
- [ ] **Step 3: Implement page creation**
  Реализовать `ensure_page`: no-op для существующей обычной страницы, отказ для journal-имени, `create_page_file` для отсутствующей и индексация пустого `PageKind::Page` по `pages/<name>.md`. В `block_create` вызвать `ensure_page` до вычисления позиции и `append_block`.
- [ ] **Step 4: Run tests to verify they pass**
  Run: `cargo test --test page_create`
  Expected: PASS.

### Task 2: Единый редактор пустой и виртуальной страницы

**Files:**
- Modify: `src/components/PageView.tsx:397-430`
- Modify: `docs/03-ui.md:231-236`

**Interfaces:**
- Consumes: существующий `blockCreate(page, content, marker)` из задачи 1.
- Produces: одинаковый composer для существующей пустой и виртуальной страницы.

- [ ] **Step 1: Enable the composer**
  Удалить неинтерактивную подсказку виртуальной страницы и условие `!virtual()` вокруг composer. Сохранить текущие Enter/blur/Escape и проверку пустого текста без изменений.
- [ ] **Step 2: Update behavior documentation**
  В `docs/03-ui.md` описать редактирование виртуальной страницы и создание файла после сохранения первой непустой записи.
- [ ] **Step 3: Verify frontend**
  Run: `npm run build`
  Expected: typecheck и Vite build PASS.

### Task 3: Полная проверка

**Files:**
- Modify: `docs/01-architecture.md`, только если итоговое поведение IPC требует уточнения.

- [ ] **Step 1: Run Rust checks**
  Run: `cargo fmt --check && cargo clippy --workspace -- -D warnings && cargo test --workspace`
  Expected: PASS.
- [ ] **Step 2: Exercise the real flow**
  Прогнать реальный IPC-сценарий на временном графе: отсутствующая страница → `block_create` → файл с блоком → `page_get` и `backlinks_get`. Проверить, что отмена пустого ввода не вызывает IPC.
- [ ] **Step 3: Inspect workspace**
  Run: `git status --short`
  Expected: только запланированные исходники, тесты и документация; временные файлы удалены.
