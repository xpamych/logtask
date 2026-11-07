# Mini Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить отключаемый мини-календарь в левую панель для перехода к существующим журналам.

**Architecture:** Чистая модель месяца строится в TypeScript без instant/timezone drift. `MiniCalendar` вызывает `JournalTape.openDay`, который догружает существующие страницы и прокручивает ленту.

**Tech Stack:** SolidJS, TypeScript, Node test runner, Rust settings, CSS.

**Spec:** `docs/superpowers/specs/2026-11-07-mini-calendar-design.md`

## Global Constraints

- Дни без журнала неактивны, файлы при клике не создаются.
- `showCalendar: true` по умолчанию; старые settings получают `true`.
- Редактирование и уже загруженные дни не теряются.
- Стили только `public/styles/global.css`, обе темы, цели ≥24×24 px.

## Review Focus

- Високосный февраль и смена года не ломают сетку.
- weekStart 0/1 меняет порядок колонок.
- Выбор старого дня догружает порции без дублей и останавливается на цели.
- graph-changed во время редактирования не затирает черновик.
- Клавиатура и screen reader различают доступные/выбранные/текущие даты.

---

### Task 1: Модель календаря и настройка

**Files:**
- Create: `src/lib/calendar.ts`
- Create: `src/lib/calendar.test.ts`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/SettingsPage.tsx`

**Interfaces:**
- Produces: `monthGrid(year,month,weekStart): CalendarDay[]`, `shiftMonth`, `todayJournalName` reuse; `Settings.showCalendar: boolean`.

- [ ] **Step 1:** Failing tests месяца/високосного года/weekStart/доступности и Rust default/old JSON/roundtrip false.
- [ ] **Step 2:** Запустить Node calendar tests и `cargo test --lib settings::tests` — FAIL.
- [ ] **Step 3:** Реализовать UTC-only модель, `showCalendar` и чекбокс «Показывать мини-календарь».
- [ ] **Step 4:** Повторить тесты + `npm run typecheck` — PASS.

### Task 2: MiniCalendar и открытие дня

**Files:**
- Create: `src/components/MiniCalendar.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/JournalTape.tsx`
- Modify: `src/App.tsx`
- Modify: `public/styles/global.css`

**Interfaces:**
- Consumes: `monthGrid` и `showCalendar` из Task 1.
- Produces: `JournalTape.openDay(name): Promise<void>`.

- [ ] **Step 1:** Failing tests openDay: день уже загружен, день требует нескольких `journalPrev`, несуществующий день отклоняется, дубликаты не добавляются.
- [ ] **Step 2:** Реализовать `openDay` с epoch, scrollIntoView и временной подсветкой; компактный календарь со стрелками/today, точками записей и недоступными датами.
- [ ] **Step 3:** Подключить Sidebar над навигацией и App через ref/signal; доступные имена, `aria-pressed`, клавиатурные стрелки/Home/End.
- [ ] **Step 4:** `node --conditions=browser --test src/lib/*.test.ts && npm run build` — PASS.

### Task 3: Документация и проверка

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/01-architecture.md`
- Modify: `docs/03-ui.md`
- Modify: `docs/04-roadmap.md`

- [ ] **Step 1:** Обновить UI, настройки и roadmap.
- [ ] **Step 2:** Полный `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && node --conditions=browser --test src/lib/graph/*.test.ts src/components/graph/*.test.ts src/lib/*.test.ts && npm run build` — PASS.
- [ ] **Step 3:** Проверить реальный UI: настройка вкл/выкл, месяцы/годы, старый день, today, клавиатура, узкая панель и обе темы; выполнить независимое ревью.
