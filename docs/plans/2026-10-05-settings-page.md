# Настройки страницей в центре — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести настройки из модалки `SettingsModal` на отдельный вид в
центральной области с переключением разделов через сайдбар и автосохранением.

**Architecture:** Спека: `docs/specs/2026-10-05-settings-page-design.md`
(ревизия 2). `View` в `App.tsx` расширяется
`{ kind: "settings"; section: SettingsSection }`; новый компонент
`SettingsPage.tsx` рендерит активный раздел; `Sidebar` получает пункт
«Настройки» с вложенными разделами и точкой-индикатором сохранения;
автосохранение живёт в `App.tsx` (`saveSettingsAuto`, дебаунс 400 мс).

**Tech Stack:** SolidJS + TypeScript (strict), Vite, один файл стилей
`public/styles/global.css`. Тестов у фронтенда нет (конвенция проекта) —
проверка каждой задачи: `npm run build` (= `tsc --noEmit && vite build`),
ожидание: зелёный. Rust не затрагивается.

**Конвенции:** комментарии и коммиты на русском; импорты через `~/*`;
обработчики `onClick`; `<For>`/`<Show>`; цвета через CSS-переменные
(`--success`/`--warning`/`--danger` уже есть).

---

### Task 1: `SettingsPage.tsx` — страница настроек с разделами

**Files:**
- Create: `src/components/SettingsPage.tsx`
- Modify: `src/components/IntegrationSources.tsx` (убрать свой заголовок секции)

- [ ] **Step 1: Создать `src/components/SettingsPage.tsx`**

Полное содержимое файла (контролы перенесены из `SettingsModal.tsx`,
вместо локального `draft` — `props.settings` + `props.onChange`):

```tsx
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { IntegrationSources } from "./IntegrationSources";

export type SettingsSection = "general" | "appearance" | "tasks" | "integrations";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "Общие" },
  { id: "appearance", label: "Внешний вид" },
  { id: "tasks", label: "Задачи" },
  { id: "integrations", label: "Интеграции" },
];

const THEMES = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

const HOME_VIEWS = [
  { value: "journal", label: "Журналы" },
  { value: "tasks", label: "Задачи" },
  { value: "pages", label: "Все страницы" },
];

/** Страница настроек: один активный раздел, автосохранение через onChange */
export function SettingsPage(props: {
  settings: Settings;
  section: SettingsSection;
  saveError: string | null;
  onChange: (s: Settings, opts?: { immediate?: boolean }) => void;
}): JSX.Element {
  // селекты/чекбоксы/цвет — сразу, текст и слайдер — с дебаунсом в App
  const patch = (p: Partial<Settings>, opts?: { immediate?: boolean }) =>
    props.onChange({ ...props.settings, ...p }, opts);

  const setStatus = (
    idx: number,
    p: Partial<Settings["statuses"][number]>,
    opts?: { immediate?: boolean },
  ) => {
    const statuses = props.settings.statuses.map((st, i) =>
      i === idx ? { ...st, ...p } : st,
    );
    patch({ statuses }, opts);
  };

  const moveStatus = (idx: number, delta: number) => {
    const statuses = [...props.settings.statuses];
    const target = idx + delta;
    if (target < 0 || target >= statuses.length) return;
    [statuses[idx], statuses[target]] = [statuses[target], statuses[idx]];
    patch({ statuses }, { immediate: true });
  };

  const sectionLabel = () =>
    SETTINGS_SECTIONS.find((s) => s.id === props.section)?.label ?? "";

  return (
    <main class="settings-page">
      <header class="settings-page-head">
        <h1 class="settings-page-title">{sectionLabel()}</h1>
        <Show when={props.saveError}>
          {(e) => <span class="settings-save-err">Ошибка сохранения: {e()}</span>}
        </Show>
      </header>

      <Show when={props.section === "general"}>
        <label class="settings-row">
          <span class="settings-label">Домашняя страница</span>
          <select
            class="settings-select"
            value={props.settings.homeView}
            onChange={(e) => patch({ homeView: e.currentTarget.value }, { immediate: true })}
          >
            <For each={HOME_VIEWS}>
              {(v) => <option value={v.value}>{v.label}</option>}
            </For>
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-label">Первый день недели</span>
          <select
            class="settings-select"
            value={String(props.settings.weekStart)}
            onChange={(e) =>
              patch({ weekStart: Number(e.currentTarget.value) }, { immediate: true })
            }
          >
            <option value="0">Воскресенье</option>
            <option value="1">Понедельник</option>
          </select>
        </label>
      </Show>

      <Show when={props.section === "appearance"}>
        <label class="settings-row">
          <span class="settings-label">Тема</span>
          <select
            class="settings-select"
            value={props.settings.theme}
            onChange={(e) => patch({ theme: e.currentTarget.value }, { immediate: true })}
          >
            <For each={THEMES}>
              {(t) => <option value={t.value}>{t.label}</option>}
            </For>
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-label">
            Размер шрифта ({props.settings.fontScale.toFixed(2)})
          </span>
          <input
            type="range"
            min="0.85"
            max="1.4"
            step="0.05"
            value={props.settings.fontScale}
            onInput={(e) => patch({ fontScale: Number(e.currentTarget.value) })}
          />
        </label>

        <label class="settings-row">
          <span class="settings-label">Системная рамка окна</span>
          <input
            type="checkbox"
            checked={props.settings.systemTitlebar}
            onChange={(e) =>
              patch({ systemTitlebar: e.currentTarget.checked }, { immediate: true })
            }
          />
        </label>
      </Show>

      <Show when={props.section === "tasks"}>
        <label class="settings-row">
          <span class="settings-label">Задач в колонке канбана</span>
          <input
            type="number"
            min="5"
            max="500"
            step="5"
            value={props.settings.kanbanLimit}
            onInput={(e) => patch({ kanbanLimit: Number(e.currentTarget.value) })}
          />
        </label>

        <div class="settings-subhead">Статусы канбана</div>
        <For each={props.settings.statuses}>
          {(st, i) => (
            <div class="status-row">
              <input
                type="color"
                class="status-color"
                value={st.color}
                onInput={(e) => setStatus(i(), { color: e.currentTarget.value })}
              />
              <input
                type="checkbox"
                checked={st.visible}
                onChange={(e) =>
                  setStatus(i(), { visible: e.currentTarget.checked }, { immediate: true })
                }
              />
              <input
                class="status-label-input"
                value={st.label}
                onInput={(e) => setStatus(i(), { label: e.currentTarget.value })}
              />
              <span class="status-marker">{st.marker}</span>
              <button
                class="status-move"
                disabled={i() === 0}
                onClick={() => moveStatus(i(), -1)}
                title="Выше"
              >
                ↑
              </button>
              <button
                class="status-move"
                disabled={i() === props.settings.statuses.length - 1}
                onClick={() => moveStatus(i(), 1)}
                title="Ниже"
              >
                ↓
              </button>
            </div>
          )}
        </For>
      </Show>

      <Show when={props.section === "integrations"}>
        <IntegrationSources
          sources={props.settings.integrations?.sources ?? []}
          onChange={(sources) =>
            patch({ integrations: { sources } }, { immediate: true })
          }
        />
      </Show>
    </main>
  );
}
```

- [ ] **Step 2: Убрать заголовок секции из `IntegrationSources.tsx`**

В `src/components/IntegrationSources.tsx:98` удалить строку
`<div class="settings-section">Интеграции</div>` — заголовок раздела
теперь рисует `SettingsPage`. Остальной JSX не менять.

- [ ] **Step 3: Проверка типов**

Run: `npm run build`
Expected: PASS (экспортируемые символы не триггерят `noUnusedLocals`;
новый компонент пока нигде не используется — это ок, подключение в Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsPage.tsx src/components/IntegrationSources.tsx
git commit -m "Настройки: компонент SettingsPage с разделами (пока не подключён)"
```

---

### Task 2: Sidebar — пункт «Настройки» с подразделами и точкой

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Обновить пропсы и импорты**

В `src/components/Sidebar.tsx` заменить импорты типов и сигнатуру пропсов:

```tsx
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { GraphSummary, RecentGraph } from "~/lib/api";
import { pickGraphDir, recentGraphs, recentRemove } from "~/lib/api";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import type { SettingsSection } from "./SettingsPage";

export function Sidebar(props: {
  summary: GraphSummary | null;
  /** активный пункт навигации: лента журнала / задачи / все страницы / открытая страница / настройки */
  view: "journal" | "pages" | "page" | "tasks" | "settings";
  /** активный раздел настроек (null — настройки закрыты) */
  settingsSection: SettingsSection | null;
  /** состояние автосохранения настроек: точка у пункта «Настройки» */
  saveState: "saved" | "dirty" | "error";
  saveError: string | null;
  favorites: string[];
  recentPages: string[];
  onOpenPage: (name: string) => void;
  onShowJournal: () => void;
  onShowTasks: () => void;
  onShowAllPages: () => void;
  onOpenSettings: (section: SettingsSection) => void;
  onOpenGraph: (path: string) => void;
  onCloseGraph: () => void;
  onSync: () => void;
  syncing: boolean;
  syncConflicts: number;
}): JSX.Element {
```

- [ ] **Step 2: Убрать кнопку-шестерёнку**

Удалить блок (строки 89–95):

```tsx
        <button
          class="settings-btn"
          title="Настройки"
          onClick={props.onOpenSettings}
        >
          ⚙
        </button>
```

Кнопку ⟳ синхронизации НЕ трогать.

- [ ] **Step 3: Добавить пункт «Настройки» с подразделами**

Сразу после кнопки «📄 Все страницы» (после её закрывающего `</button>`,
внутри `<div class="nav-list">`) вставить:

```tsx
          <button
            class="nav-item nav-settings"
            classList={{ active: props.view === "settings" }}
            onClick={() => props.onOpenSettings("general")}
          >
            ⚙ Настройки
            <span
              class="save-dot"
              classList={{
                saved: props.saveState === "saved",
                dirty: props.saveState === "dirty",
                error: props.saveState === "error",
              }}
              title={
                props.saveState === "error"
                  ? `Ошибка сохранения: ${props.saveError ?? ""}`
                  : props.saveState === "dirty"
                    ? "Сохранение…"
                    : "Настройки сохранены"
              }
            />
          </button>
          <Show when={props.view === "settings" && props.settingsSection}>
            {(sec) => (
              <div class="nav-sublist">
                <For each={SETTINGS_SECTIONS}>
                  {(s) => (
                    <button
                      class="nav-item nav-subitem"
                      classList={{ active: sec() === s.id }}
                      onClick={() => props.onOpenSettings(s.id)}
                    >
                      {s.label}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
```

- [ ] **Step 4: Проверка типов**

Run: `npm run build`
Expected: FAIL с ошибками в `App.tsx` — пропсы Sidebar изменились
(чинится в Task 3). Ошибок внутри `Sidebar.tsx` быть не должно.
Коммит откладывается до Task 3 (одна логическая единица).

---

### Task 3: App.tsx — вид «settings» в навигации и автосохранение

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Импорты и сигналы**

Заменить импорт модалки (строка 22):

```ts
import { SettingsPage } from "~/components/SettingsPage";
import type { SettingsSection } from "~/components/SettingsPage";
```

Заменить сигнал `showSettings` (строка 71):

```ts
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection | null>(null);
```

Рядом (после `toast`/sync-сигналов, ~строка 83) добавить состояние
автосохранения:

```ts
  // автосохранение настроек: точка-индикатор в сайдбаре
  const [saveState, setSaveState] = createSignal<"saved" | "dirty" | "error">("saved");
  const [saveError, setSaveError] = createSignal<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // изменения со страницы настроек: мгновенно в сигнал (тема/шрифт
  // применяются сразу), на диск — сразу или с дебаунсом 400 мс
  const saveSettingsAuto = (s: Settings, opts?: { immediate?: boolean }) => {
    setSettings(s);
    setSaveState("dirty");
    setSaveError(null);
    clearTimeout(saveTimer);
    const run = () => {
      void settingsSave(s)
        .then(() => setSaveState("saved"))
        .catch((e) => {
          setSaveState("error");
          setSaveError(String(e));
        });
    };
    if (opts?.immediate) run();
    else saveTimer = setTimeout(run, 400);
  };
```

- [ ] **Step 2: Расширить `View`, `currentView`, `applyView`, `navView`**

Тип `View` (строки 133–137):

```ts
  type View =
    | { kind: "journal" }
    | { kind: "tasks" }
    | { kind: "pages" }
    | { kind: "settings"; section: SettingsSection }
    | { kind: "page"; name: string };
```

`currentView()` (строки 139–146) — настройки в приоритете:

```ts
  const currentView = (): View =>
    settingsSection()
      ? { kind: "settings", section: settingsSection()! }
      : current()
        ? { kind: "page", name: current()! }
        : showTasks()
          ? { kind: "tasks" }
          : showAllPages()
            ? { kind: "pages" }
            : { kind: "journal" };
```

`applyView` (строки 151–156):

```ts
  const applyView = (v: View) => {
    setFocusUuid(null);
    setSettingsSection(v.kind === "settings" ? v.section : null);
    setCurrent(v.kind === "page" ? v.name : null);
    setShowTasks(v.kind === "tasks");
    setShowAllPages(v.kind === "pages");
  };
```

Рядом с `showAllPagesView` (~строка 214) добавить:

```ts
  const showSettingsView = (section: SettingsSection) =>
    navigate({ kind: "settings", section });
```

`navView` (строки 237–238):

```ts
  // активный пункт навигации сайдбара
  const navView = (): "journal" | "pages" | "page" | "tasks" | "settings" =>
    settingsSection()
      ? "settings"
      : current()
        ? "page"
        : showTasks()
          ? "tasks"
          : showAllPages()
            ? "pages"
            : "journal";
```

- [ ] **Step 3: Пропсы Sidebar**

В JSX сайдбара (строки 433–448) заменить `onOpenSettings={() => setShowSettings(true)}`
и добавить новые пропсы:

```tsx
            <Sidebar
              summary={summary()}
              view={navView()}
              settingsSection={settingsSection()}
              saveState={saveState()}
              saveError={saveError()}
              favorites={settings().favorites}
              recentPages={recentPages()}
              onOpenPage={openPage}
              onShowJournal={showJournal}
              onShowTasks={showTasksPage}
              onShowAllPages={showAllPagesView}
              onOpenSettings={showSettingsView}
              onOpenGraph={openGraph}
              onCloseGraph={() => void closeGraph()}
              onSync={() => void runSync()}
              syncing={syncing()}
              syncConflicts={syncConflicts()}
            />
```

- [ ] **Step 4: Рендер SettingsPage в центре**

Блок центральной области (строки 451–491) обернуть: настройки проверяются
первыми. Заменить весь `<Show when={summary()}>…</Show>` на:

```tsx
          <Show when={summary()}>
            <Show
              when={settingsSection()}
              fallback={
                <Show
                  when={current()}
                  fallback={
                    <Show
                      when={showTasks()}
                      fallback={
                        <Show
                          when={showAllPages()}
                          fallback={<JournalTape refreshKey={refreshKey()} onOpenPage={openPage} settings={settings()} />}
                        >
                          <AllPages
                            pages={pages()}
                            favorites={settings().favorites}
                            onOpenPage={openPage}
                            onToggleFavorite={toggleFavorite}
                          />
                        </Show>
                      }
                    >
                      <TasksPage
                        refreshKey={refreshKey()}
                        settings={settings()}
                        onOpenPage={openPage}
                      />
                    </Show>
                  }
                >
                  {(name) => (
                    <PageView
                      name={name()}
                      onOpenPage={openPage}
                      refreshKey={refreshKey()}
                      focusUuid={focusUuid()}
                      settings={settings()}
                      favorite={settings().favorites.includes(name())}
                      onToggleFavorite={() => toggleFavorite(name())}
                    />
                  )}
                </Show>
              }
            >
              {(sec) => (
                <SettingsPage
                  settings={settings()}
                  section={sec()}
                  saveError={saveError()}
                  onChange={saveSettingsAuto}
                />
              )}
            </Show>
          </Show>
```

- [ ] **Step 5: Удалить рендер модалки**

Удалить блок (строки 508–514):

```tsx
        <Show when={showSettings()}>
          <SettingsModal
            settings={settings()}
            onClose={() => setShowSettings(false)}
            onSaved={setSettings}
          />
        </Show>
```

- [ ] **Step 6: Проверка**

Run: `npm run build`
Expected: зелёный (SettingsModal ещё существует как файл, но не
импортируется — `tsc` с `noUnusedLocals` ругается только на локальные
символы, не на неиспользуемые файлы).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "Настройки: вид в центре, пункт в сайдбаре с подразделами, автосохранение"
```

---

### Task 4: Стили

**Files:**
- Modify: `public/styles/global.css`

- [ ] **Step 1: Добавить стили страницы настроек, подразделов и точки**

В конец `public/styles/global.css` добавить:

```css
/* Страница настроек */
.settings-page {
  overflow-y: auto;
  padding: 12px 18px 18px;
}

.settings-page-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}

.settings-page-title {
  font-size: 18px;
  margin: 0;
}

.settings-save-err {
  color: var(--danger);
  font-size: 12px;
}

.settings-subhead {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin: 14px 0 6px;
}

/* Подразделы настроек в сайдбаре */
.nav-sublist {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.nav-subitem {
  padding-left: 26px;
  font-size: 13px;
}

/* Точка состояния сохранения настроек */
.nav-settings {
  display: flex;
  align-items: center;
  gap: 6px;
}

.save-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.save-dot.saved {
  background: var(--success);
}

.save-dot.dirty {
  background: var(--warning);
}

.save-dot.error {
  background: var(--danger);
}
```

- [ ] **Step 2: Удалить неиспользуемый `.settings-section`**

После Task 1 класс `.settings-section` нигде не используется (проверить:
`grep -rn "settings-section" src/` — пусто). Удалить правило
`.settings-section { … }` из `global.css` (~строки 1415–1421).

- [ ] **Step 3: Проверка**

Run: `npm run build`
Expected: зелёный.

- [ ] **Step 4: Commit**

```bash
git add public/styles/global.css
git commit -m "Настройки: стили страницы, подразделов сайдбара и точки сохранения"
```

---

### Task 5: Удаление модалки и документация

**Files:**
- Delete: `src/components/SettingsModal.tsx`
- Modify: `docs/03-ui.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Удалить `src/components/SettingsModal.tsx`**

```bash
git rm src/components/SettingsModal.tsx
```

Стили `.modal-*` НЕ удалять — их использует `QueryEditor.tsx`.

- [ ] **Step 2: Обновить `docs/03-ui.md`**

В разделе «Темы и поведение» абзац про настройки графа (последний,
начинается с «Настройки графа — `<граф>/.logtask/settings.json`») дополнить
предложением в конец:

```
  Настройки открываются страницей в центре: пункт «Настройки» в навигации
  сайдбара (под «Все страницы»), при открытии под ним появляются вложенные
  разделы — Общие / Внешний вид / Задачи / Интеграции; переходы по разделам
  попадают в историю видов. Сохранение автоматическое (дебаунс 400 мс),
  состояние — точка у пункта «Настройки»: зелёная — сохранено, жёлтая —
  сохранение, красная — ошибка.
```

Также в строке 26 абзаца про topbar фраза «включается настройкой
`systemTitlebar` (чекбокс «Системная рамка окна» в настройках)» остаётся
корректной — не трогать.

- [ ] **Step 3: Обновить `AGENTS.md`**

В пункте про `src/components/` заменить `SettingsModal` на `SettingsPage`
(строка: «`components/` — `JournalTape`, `PageView`, `BlockView` …»,
там перечислены `Kanban`, `Matrix`, `Queries`, `QueryEditor`, `Sidebar`,
`SettingsModal`, `TaskCard`).

- [ ] **Step 4: Финальная проверка**

Run: `npm run build`
Expected: зелёный.

Run: `git grep -n "SettingsModal" -- src/ docs/ AGENTS.md`
Expected: пусто (ни одного упоминания).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Настройки: модалка удалена, доки обновлены"
```

---

### Task 6: Финал — проверки и пуш

- [ ] **Step 1: Полная проверка проекта**

Run: `cargo test --workspace` — зелёный (Rust не менялся, sanity-check).
Run: `npm run build` — зелёный.

- [ ] **Step 2: Ручной прогон (пользователем)**

`npm run app:dev`: вход через «Настройки» в сайдбаре, вложенные разделы,
автосохранение (точка жёлтая → зелёная), тема/шрифт применяются сразу,
←/→ по истории ходит через разделы настроек.

- [ ] **Step 3: Push**

```bash
git push
```

(уходит в оба ремоута: git.alr-pkg.ru + github.com)
