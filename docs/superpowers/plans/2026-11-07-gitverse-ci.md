# GitVerse CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запускать проверки и публикацию Linux-релизов на облачных раннерах GitVerse.

**Architecture:** Два отдельных workflow в `.gitverse/workflows/` повторяют текущие проверки и сборку. Публикация использует официальный `actions/create-release@v1` и текст аннотированного тега.

**Tech Stack:** GitVerse Actions, YAML, Ubuntu, Node 24, Rust stable, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-11-07-gitverse-ci-design.md`

## Global Constraints

- Все job используют `runs-on: ubuntu-latest`.
- `.github/` и `.gitea/` не изменяются.
- Публикация требует `GITVERSE_API_KEY` с правом «Репозитории → Запись».

## Review Focus

- Отсутствует секрет: сборка должна завершаться, а ошибка авторизации должна относиться только к публикации.
- Неаннотированный тег: релизный workflow должен остановиться до публикации.
- Некоторые пакеты не собрались: tar.gz обязателен, DEB/RPM/AppImage передаются при наличии.
- Многострочное описание тега: оно должно попасть в release body без потери переводов строк.
- Повторный релиз: action должен обновить его и заменить одноимённые файлы.

---

### Task 1: Проверки на облачном раннере

**Files:**
- Create: `.gitverse/workflows/check.yml`

**Interfaces:**
- Produces: workflow `Проверки` на `push` и `pull_request`.

- [ ] **Step 1: Проверить отсутствие конфигурации**
  Run: `test ! -e .gitverse/workflows/check.yml`
  Expected: PASS до создания файла.
- [ ] **Step 2: Добавить workflow**
  Перенести шаги `.github/workflows/check.yml`, установить `runs-on: ubuntu-latest`; сохранить системные зависимости, Node 24, Rust stable и все команды проверок.
- [ ] **Step 3: Проверить YAML и runner**
  Разобрать файл YAML-парсером и проверить, что единственный job имеет `runs-on: ubuntu-latest`.

### Task 2: Сборка и публикация релиза

**Files:**
- Create: `.gitverse/workflows/release.yml`

**Interfaces:**
- Consumes: официальный `actions/create-release@v1`, секрет `GITVERSE_API_KEY`.
- Produces: tag-triggered workflow `Release` с tar.gz и доступными DEB/RPM/AppImage.

- [ ] **Step 1: Добавить сборку**
  Перенести проверки и шаги формирования архивов из GitHub release; задать `runs-on: ubuntu-latest`, `timeout-minutes: 60`, checkout с `fetch-depth: 0`.
- [ ] **Step 2: Добавить публикацию**
  Проверить аннотированный тег, извлечь его многострочное описание через `$GITVERSE_OUTPUT`, передать title/body/files и `${{ secrets.GITVERSE_API_KEY }}` в `actions/create-release@v1`.
- [ ] **Step 3: Проверить конфигурацию**
  Разобрать оба YAML, сверить состав файлов релиза с GitHub workflow, выполнить `git diff --check`.
- [ ] **Step 4: Проверить проект**
  Run: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && npm run build`
  Expected: PASS.
- [ ] **Step 5: Опубликовать**
  Создать русский атомарный коммит, отправить `master` в `github` и `gitverse`; сообщить о необходимости секрета и дальнейшей проверке cloud run.
