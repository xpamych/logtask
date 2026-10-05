import { For, Index, Show } from "solid-js";
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

// кегль в пунктах: база 14px при fontScale 1.0, 1pt = 4/3 px → pt = scale * 10.5
const fontPt = (scale: number) => Math.round(scale * 10.5 * 2) / 2;

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
            Размер шрифта ({fontPt(props.settings.fontScale)} pt)
          </span>
          <input
            type="range"
            min="9"
            max="15"
            step="0.5"
            value={fontPt(props.settings.fontScale)}
            onInput={(e) =>
              patch({ fontScale: Number(e.currentTarget.value) / 10.5 })
            }
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

        <div class="settings-section">Статусы канбана</div>
        {/* Index, не For: правка статуса создаёт новые объекты, и For
            пересоздавал бы DOM-узлы, сбивая фокус ввода названия */}
        <Index each={props.settings.statuses}>
          {(st, i) => (
            <div class="status-row">
              <input
                type="color"
                class="status-color"
                value={st().color}
                onInput={(e) => setStatus(i, { color: e.currentTarget.value })}
              />
              <input
                type="checkbox"
                checked={st().visible}
                onChange={(e) =>
                  setStatus(i, { visible: e.currentTarget.checked }, { immediate: true })
                }
              />
              <input
                class="status-label-input"
                value={st().label}
                onInput={(e) => setStatus(i, { label: e.currentTarget.value })}
              />
              <span class="status-marker">{st().marker}</span>
              <button
                class="status-move"
                disabled={i === 0}
                onClick={() => moveStatus(i, -1)}
                title="Выше"
              >
                ↑
              </button>
              <button
                class="status-move"
                disabled={i === props.settings.statuses.length - 1}
                onClick={() => moveStatus(i, 1)}
                title="Ниже"
              >
                ↓
              </button>
            </div>
          )}
        </Index>
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
