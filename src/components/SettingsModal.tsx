import { For, Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { settingsSave } from "~/lib/api";

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

export function SettingsModal(props: {
  settings: Settings;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal<Settings>(
    JSON.parse(JSON.stringify(props.settings)),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await settingsSave(draft());
      props.onSaved(draft());
      props.onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const moveStatus = (idx: number, delta: number) => {
    setDraft((d) => {
      const statuses = [...d.statuses];
      const target = idx + delta;
      if (target < 0 || target >= statuses.length) return d;
      [statuses[idx], statuses[target]] = [statuses[target], statuses[idx]];
      return { ...d, statuses };
    });
  };

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <header class="modal-head">
          <span class="modal-title">Настройки</span>
          <button class="modal-close" onClick={props.onClose}>
            ✕
          </button>
        </header>

        <div class="modal-body">
          <Show when={error()}>
            {(e) => <div class="error">{e()}</div>}
          </Show>

          <label class="settings-row">
            <span class="settings-label">Тема</span>
            <select
              class="settings-select"
              value={draft().theme}
              onChange={(e) =>
                setDraft((d) => ({ ...d, theme: e.currentTarget.value }))
              }
            >
              <For each={THEMES}>
                {(t) => <option value={t.value}>{t.label}</option>}
              </For>
            </select>
          </label>

          <label class="settings-row">
            <span class="settings-label">
              Размер шрифта ({draft().fontScale.toFixed(2)})
            </span>
            <input
              type="range"
              min="0.85"
              max="1.4"
              step="0.05"
              value={draft().fontScale}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  fontScale: Number(e.currentTarget.value),
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Задач в колонке канбана</span>
            <input
              type="number"
              min="5"
              max="500"
              step="5"
              value={draft().kanbanLimit}
              onInput={(e) =>
                setDraft((d) => ({
                  ...d,
                  kanbanLimit: Number(e.currentTarget.value),
                }))
              }
            />
          </label>

          <label class="settings-row">
            <span class="settings-label">Первый день недели</span>
            <select
              class="settings-select"
              value={String(draft().weekStart)}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  weekStart: Number(e.currentTarget.value),
                }))
              }
            >
              <option value="0">Воскресенье</option>
              <option value="1">Понедельник</option>
            </select>
          </label>

          <label class="settings-row">
            <span class="settings-label">Домашняя страница</span>
            <select
              class="settings-select"
              value={draft().homeView}
              onChange={(e) =>
                setDraft((d) => ({ ...d, homeView: e.currentTarget.value }))
              }
            >
              <For each={HOME_VIEWS}>
                {(v) => <option value={v.value}>{v.label}</option>}
              </For>
            </select>
          </label>

          <label class="settings-row">
            <span class="settings-label">Системная рамка окна</span>
            <input
              type="checkbox"
              checked={draft().systemTitlebar}
              onChange={(e) =>
                setDraft((d) => ({ ...d, systemTitlebar: e.currentTarget.checked }))
              }
            />
          </label>

          <div class="settings-section">Статусы канбана</div>
          <For each={draft().statuses}>
            {(st, i) => (
              <div class="status-row">
                <input
                  type="color"
                  class="status-color"
                  value={st.color}
                  onInput={(e) =>
                    setDraft((d) => {
                      const statuses = [...d.statuses];
                      statuses[i()] = {
                        ...statuses[i()],
                        color: e.currentTarget.value,
                      };
                      return { ...d, statuses };
                    })
                  }
                />
                <input
                  type="checkbox"
                  checked={st.visible}
                  onChange={(e) =>
                    setDraft((d) => {
                      const statuses = [...d.statuses];
                      statuses[i()] = {
                        ...statuses[i()],
                        visible: e.currentTarget.checked,
                      };
                      return { ...d, statuses };
                    })
                  }
                />
                <input
                  class="status-label-input"
                  value={st.label}
                  onInput={(e) =>
                    setDraft((d) => {
                      const statuses = [...d.statuses];
                      statuses[i()] = {
                        ...statuses[i()],
                        label: e.currentTarget.value,
                      };
                      return { ...d, statuses };
                    })
                  }
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
                  disabled={i() === draft().statuses.length - 1}
                  onClick={() => moveStatus(i(), 1)}
                  title="Ниже"
                >
                  ↓
                </button>
              </div>
            )}
          </For>
        </div>

        <footer class="modal-foot">
          <button class="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button class="btn primary" disabled={saving()} onClick={save}>
            {saving() ? "Сохранение…" : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  );
}
