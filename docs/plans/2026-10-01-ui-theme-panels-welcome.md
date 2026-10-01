# План: системная тема, ресайз панелей, приветственный экран, палитра ppdb

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель:** реализовать spec `docs/specs/2026-10-01-ui-theme-panels-welcome.md`: тема «Системная» с live-переключением, резайзабельные боковые панели с сохранением ширины, приветственный экран при невыбранном графе, новая палитра (ppdb: бирюза #09bec8 + фиолет #9b59b6).

**Архитектура:** бэкенд — только новые поля в `settings.rs` (theme default "system", sidebarWidth/taskpanelWidth, цвета статусов). Весь остальной функционал — фронтенд SolidJS: matchMedia для системной темы, pointer events для ресайзеров, компонент Welcome. Палитра — только значения CSS-переменных в `public/styles/global.css`.

**Стек:** Rust (serde), SolidJS + strict TS, CSS-переменные. Проверки: `cargo test --workspace`, `cargo clippy --workspace --all-targets`, `npx tsc --noEmit`, `npm run build`. Коммиты на русском.

**Контекст для исполнителя:** ветка `fix/review-fixes` (не переключать). Текущее: `theme` default "dark" (settings.rs:48), селект темы в SettingsModal.tsx:62-69, layout `grid-template-columns: 240px 1fr 320px` (global.css:40-42), ошибка «граф не выбран» показывается текстом в App.tsx (`error()`). Существующие settings.json пользователя с `theme: "dark"/"light"` должны продолжать работать.

---

### Задача 1: settings.rs — theme "system", ширины панелей, цвета ppdb

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Шаг 1: Failing-тесты** (обновить/добавить в `mod tests`)

```rust
#[test]
fn defaults_are_six_statuses() {
    let s = Settings::default();
    assert_eq!(s.statuses.len(), 6);
    assert_eq!(s.statuses[0].marker, "LATER");
    assert_eq!(s.statuses[2].label, "В работе");
    assert_eq!(s.theme, "system");
    assert_eq!(s.sidebar_width, 240);
    assert_eq!(s.taskpanel_width, 320);
}

#[test]
fn missing_file_gives_defaults() {
    let dir = std::env::temp_dir().join("logtask_settings_missing");
    let _ = std::fs::remove_dir_all(&dir);
    let s = load(&dir);
    assert_eq!(s.theme, "system");
    assert_eq!(s.sidebar_width, 240);
}
```

(тест `save_and_load_roundtrip` дополнить полями `sidebar_width: 300, taskpanel_width: 400` и их проверками после load.)

- [ ] **Шаг 2: Поля и дефолты**

В `Settings` после `kanban_limit`:

```rust
    /// ширина левой панели (px)
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    /// ширина правой панели задач (px)
    #[serde(default = "default_taskpanel_width")]
    pub taskpanel_width: u32,
```

```rust
fn default_theme() -> String {
    "system".to_string()
}
fn default_sidebar_width() -> u32 {
    240
}
fn default_taskpanel_width() -> u32 {
    320
}
```

`Default for Settings` — добавить оба поля. Doc-комментарий `theme` — `"system" | "dark" | "light"`.

- [ ] **Шаг 3: Цвета статусов в палитру ppdb** (`default_statuses`)

```rust
        // LATER:   color: "#888888" (text-tertiary)
        // TODO:    color: "#09bec8" (primary)
        // DOING:   color: "#ff9800" (warning)
        // REVIEW:  color: "#9b59b6" (secondary)
        // DONE:    color: "#4caf50" (success)
        // CANCELED: color: "#f44336" (error)
```

- [ ] **Шаг 4: Тесты + коммит**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets && cargo fmt --check`

```bash
git add -A
git commit -m "Настройки: тема system по умолчанию, ширины панелей, цвета статусов ppdb"
```

---

### Задача 2: api.ts — тип Settings

**Files:**
- Modify: `src/lib/api.ts` (interface Settings, ~:191)

- [ ] **Шаг 1: Добавить поля**

```ts
export interface Settings {
  theme: string;
  fontScale: number;
  weekStart: number;
  kanbanLimit: number;
  sidebarWidth: number;
  taskpanelWidth: number;
  statuses: StatusConfig[];
}
```

- [ ] **Шаг 2: Проверить DEFAULT_SETTINGS в App.tsx**

Найти `DEFAULT_SETTINGS` в `src/App.tsx` (инициализация сигнала settings) — дополнить `sidebarWidth: 240, taskpanelWidth: 320`, `theme: "system"`.

- [ ] **Шаг 3: Проверка + коммит**

Run: `npx tsc --noEmit`

```bash
git add -A
git commit -m "UI: тип Settings — ширины панелей"
```

---

### Задача 3: Системная тема с live-переключением

**Files:**
- Modify: `src/App.tsx` (эффект темы, ~:74-79)

- [ ] **Шаг 1: Эффект системной темы**

Заменить существующий эффект применения темы:

```ts
// тема: system — следуем ОС и переключаемся на лету
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const [osDark, setOsDark] = createSignal(systemDark.matches);
onMount(() => {
  const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
  systemDark.addEventListener("change", onChange);
  onCleanup(() => systemDark.removeEventListener("change", onChange));
});

createEffect(() => {
  const s = settings();
  const dark = s.theme === "system" ? osDark() : s.theme !== "light";
  document.body.classList.toggle("theme-light", !dark);
  document.body.classList.toggle("theme-dark", dark);
  document.documentElement.style.fontSize = `${s.fontScale * 14}px`;
});
```

(если `matchMedia` недоступен — `osDark()` инициализирован false → light; приемлемо, но лучше `?? true` для dark fallback: `createSignal(systemDark?.matches ?? true)` — выбрать защищённый вариант.)

- [ ] **Шаг 2: SettingsModal — селект из трёх** (SettingsModal.tsx:62-69)

Заменить текущий контрол темы на:

```tsx
<select
  value={draft().theme}
  onChange={(e) => setDraft((d) => ({ ...d, theme: e.currentTarget.value }))}
>
  <option value="system">Системная</option>
  <option value="light">Светлая</option>
  <option value="dark">Тёмная</option>
</select>
```

(свериться с реальной разметкой — если там уже select с двумя option, просто добавить system первым и сделать дефолтным; классы оставить.)

- [ ] **Шаг 3: Проверка + коммит**

Run: `npx tsc --noEmit && npm run build`

```bash
git add -A
git commit -m "UI: тема «Системная» следует ОС и переключается на лету"
```

---

### Задача 4: Ресайз панелей

**Files:**
- Create: `src/components/PanelResizer.tsx`
- Modify: `src/App.tsx` (layout, ~:121-131)
- Modify: `public/styles/global.css`

- [ ] **Шаг 1: PanelResizer**

```tsx
import { onCleanup } from "solid-js";

interface Props {
  /** новая ширина во время drag */
  onResize: (px: number) => void;
  /** финальная ширина после отпускания (сохранение) */
  onCommit: (px: number) => void;
  /** стартовая ширина */
  start: () => number;
  /** left — ширина считается от левого края, right — от правого */
  side: "left" | "right";
  min?: number;
  max?: number;
}

export default function PanelResizer(props: Props) {
  const min = () => props.min ?? 180;
  const max = () => props.max ?? 480;
  const clamp = (px: number) => Math.min(max(), Math.max(min(), px));

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = props.start();
    document.body.classList.add("panel-resizing");

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = props.side === "left" ? startW + dx : startW - dx;
      props.onResize(clamp(w));
    };
    const up = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = props.side === "left" ? startW + dx : startW - dx;
      props.onCommit(clamp(w));
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    onCleanup(() => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    });
  };

  return <div class="panel-resizer" onPointerDown={onPointerDown} />;
}
```

- [ ] **Шаг 2: App.tsx — сигналы ширин, инлайн-grid, ручки**

```ts
const [sidebarW, setSidebarW] = createSignal(settings().sidebarWidth);
const [panelW, setPanelW] = createSignal(settings().taskpanelWidth);
// при загрузке settings (после settingsGet) обновить: setSidebarW(s.sidebarWidth); setPanelW(s.taskpanelWidth);

const commitWidths = () => {
  const s = { ...settings(), sidebarWidth: sidebarW(), taskpanelWidth: panelW() };
  setSettings(s);
  void settingsSave(s).catch((e) => console.error("settings save:", e));
};
```

В корневой div: `class="app"` + `style={{ "grid-template-columns": `${sidebarW()}px 1fr ${panelW()}px` }}`. Между `<Sidebar/>` и центральным `<Show>` — `<PanelResizer side="left" start={sidebarW} onResize={setSidebarW} onCommit={() => commitWidths()} />`; перед `<aside class="taskpanel">` — аналогично `side="right"`/`panelW`. Хардкод колонок из `global.css` `.app` убрать.

- [ ] **Шаг 3: Стили**

```css
.panel-resizer {
  width: 5px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}
.panel-resizer:hover,
body.panel-resizing .panel-resizer {
  background: var(--accent);
  opacity: 0.4;
}
body.panel-resizing {
  user-select: none;
  cursor: col-resize;
}
```

- [ ] **Шаг 4: Проверка + коммит**

Run: `npx tsc --noEmit && npm run build`

```bash
git add -A
git commit -m "UI: боковые панели ресайзятся перетаскиванием, ширина сохраняется"
```

---

### Задача 5: Приветственный экран Welcome

**Files:**
- Create: `src/components/Welcome.tsx`
- Modify: `src/App.tsx` (ветка при отсутствии графа)
- Modify: `public/styles/global.css`

- [ ] **Шаг 1: Компонент**

```tsx
interface Props {
  onPick: () => void;
}

export default function Welcome(props: Props) {
  return (
    <div class="welcome">
      <img class="welcome-logo" src="/icon.svg" alt="" />
      <h1 class="welcome-title">Logtask</h1>
      <p class="welcome-text">
        Журнал и задачи прямо над вашими .md-файлами в формате Logseq.
        Без базы данных — файлы остаются источником истины.
      </p>
      <button class="welcome-pick" onClick={props.onPick}>
        Выбрать папку графа
      </button>
    </div>
  );
}
```

(иконка: проверить, что есть в `public/` или использовать `src-tauri/icons/128x128.png`, скопировав в `public/` при необходимости; если svg нет — png.)

- [ ] **Шаг 2: Ветка в App.tsx**

Состояние «граф не выбран»: `summary() === null && error()` содержит «граф не выбран». В этом случае рендерить `<Welcome onPick={pickGraph} />` вместо всего layout (сайдбар и панель скрыты):

```tsx
const graphNotChosen = () => !summary() && (error() ?? "").includes("граф не выбран");

const pickGraph = async () => {
  const path = await pickGraphDir();
  if (path) await openGraph(path);
};
```

В return: `<Show when={!graphNotChosen()} fallback={<Welcome onPick={pickGraph} />}> ...существующий layout... </Show>`. Ошибку `error()` при этом состоянии внутри layout не показывать (она «штатная»); другие ошибки — как раньше. Импортировать `pickGraphDir` из `~/lib/api`.

- [ ] **Шаг 3: Стили**

```css
.welcome {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
  padding: 40px;
}
.welcome-logo { width: 96px; height: 96px; }
.welcome-title { margin: 0; font-size: 28px; }
.welcome-text { max-width: 420px; color: var(--fg-muted); line-height: 1.5; }
.welcome-pick {
  margin-top: 8px;
  padding: 12px 28px;
  font-size: 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}
.welcome-pick:hover { filter: brightness(1.1); }
```

- [ ] **Шаг 4: Проверка + коммит**

Run: `npx tsc --noEmit && npm run build`

```bash
git add -A
git commit -m "UI: приветственный экран выбора графа при первом запуске"
```

---

### Задача 6: Палитра ppdb в global.css

**Files:**
- Modify: `public/styles/global.css`

- [ ] **Шаг 1: Тёмная тема (`:root`)**

```css
:root {
  --bg: #222222;
  --bg-alt: #2a2a2a;
  --bg-panel: #1a1a1a;
  --fg: #ffffff;
  --fg-muted: #b0b0b0;
  --accent: #09bec8;
  --accent-2: #9b59b6;
  --border: #3a3a3a;
}
```

(свериться с реальным набором переменных в файле — заменить значения, сохранив имена; если есть дополнительные переменные (success/warning/error) — привести к ppdb: `#4caf50`/`#ff9800`/`#f44336`.)

- [ ] **Шаг 2: Светлая тема (`body.theme-light`)**

```css
body.theme-light {
  --bg: #f4f6f7;
  --bg-alt: #e9eef0;
  --bg-panel: #ffffff;
  --fg: #1c2733;
  --fg-muted: #5c7080;
  --accent: #0891a0;
  --accent-2: #7d3c98;
  --border: #d5dde1;
}
```

- [ ] **Шаг 3: Sweep хардкоженных цветов**

Grep `#[0-9a-fA-F]{3,6}` по global.css вне блоков `:root`/`body.theme-light` — найденные заменить на переменные (по смыслу: ссылки/теги → `--accent-2`, акценты → `--accent`, границы → `--border`). Grep хардкоженных цветов в `src/components/*.tsx` — тоже на переменные.

- [ ] **Шаг 4: Проверка + коммит**

Run: `npm run build`

```bash
git add -A
git commit -m "UI: палитра ppdb (бирюза/фиолет) вместо цветов Logseq"
```

---

### Задача 7: docs/03-ui.md + финальная проверка

**Files:**
- Modify: `docs/03-ui.md`

- [ ] **Шаг 1: Обновить docs/03-ui.md** по факту: тема (три режима, system по умолчанию, live-переключение), ресайзеры панелей (180–480px, сохранение в settings.json), приветственный экран, палитра ppdb, новые поля settings.json (`sidebarWidth`, `taskpanelWidth`, `theme: "system"`).

- [ ] **Шаг 2: Финальные проверки**

Run: `cargo fmt --check && cargo clippy --workspace --all-targets && cargo test --workspace && npx tsc --noEmit && npm run build`

- [ ] **Шаг 3: Коммит**

```bash
git add -A
git commit -m "Docs: системная тема, ресайзеры, Welcome, палитра в 03-ui"
```

- [ ] **Шаг 4: Ручной прогон (пользователем)**

`./build-git.sh && ./target/release/logtask`: чистый запуск (временно переименовать `~/.config/logtask/recent.json`) → Welcome → выбор графа → лента; смена темы ОС на лету; drag обеих ручек + перезапуск; обе темы.

---

## Самопроверка плана

- Покрытие spec: п.1 тема → Задачи 1,3; п.2 ресайз → Задачи 1,2,4; п.3 Welcome → Задача 5; п.4 палитра → Задачи 1,6; тесты/доки → 1,7. Все файлы из spec «Затронутые файлы» покрыты.
- Согласованность имён: `sidebar_width/taskpanel_width` (Rust) ↔ `sidebarWidth/taskpanelWidth` (serde camelCase ↔ TS) — единообразно во всех задачах.
- Обратная совместимость: старые `theme: "dark"/"light"` читаются; отсутствующие поля ширин — serde default.
