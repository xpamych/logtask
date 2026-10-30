import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { COMMAND_DEFINITIONS } from "~/lib/commands";
import type { CommandContext } from "~/lib/commands";
import { pushModalContext } from "~/lib/modalState";
import {
  effectiveShortcuts,
  formatShortcut,
  isProtectedShortcut,
  normalizeShortcut,
  resetShortcutOverride,
  shortcutConflict,
} from "~/lib/shortcuts";

const GROUPS: { id: CommandContext; label: string }[] = [
  { id: "global", label: "Общие" },
  { id: "taskList", label: "Список задач" },
  { id: "taskMenu", label: "Меню задачи" },
];

export function ShortcutSettings(props: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}): JSX.Element {
  const [capturing, setCapturing] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const isMac = navigator.platform.includes("Mac");
  const effective = () => effectiveShortcuts(props.settings.shortcuts);

  createEffect(() => {
    if (!capturing()) return;
    const close = pushModalContext("capture");
    onCleanup(close);
  });

  const save = (shortcuts: Record<string, string | null>) => {
    props.onChange({ ...props.settings, shortcuts });
  };

  const capture = (e: KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      setCapturing(null);
      setError(null);
      return;
    }
    if (e.code === "Backspace") {
      save({ ...props.settings.shortcuts, [id]: null });
      setCapturing(null);
      setError(null);
      return;
    }
    const shortcut = normalizeShortcut(e, isMac);
    if (!shortcut) return;
    if (isProtectedShortcut(shortcut)) {
      setError("Это сочетание зарезервировано для редактирования или системы");
      return;
    }
    const conflict = shortcutConflict(id, shortcut, effective());
    if (conflict) {
      const other = COMMAND_DEFINITIONS.find((command) => command.id === conflict);
      setError(`Уже назначено: ${other?.label ?? conflict}`);
      return;
    }
    save({ ...props.settings.shortcuts, [id]: shortcut });
    setCapturing(null);
    setError(null);
  };

  return (
    <div class="shortcut-settings">
      <div class="settings-row">
        <span class="settings-label">Нажмите сочетание, затем новые клавиши. Escape — отмена, Backspace — очистить.</span>
        <button
          class="settings-btn"
          onClick={() => {
            if (confirm("Сбросить все горячие клавиши к стандартным?")) save({});
          }}
        >
          Сбросить все
        </button>
      </div>
      <Show when={error()}>{(message) => <div class="error">{message()}</div>}</Show>
      <For each={GROUPS}>
        {(group) => (
          <section class="shortcut-settings-group">
            <h2>{group.label}</h2>
            <For each={COMMAND_DEFINITIONS.filter((command) => command.context === group.id)}>
              {(command) => (
                <div class="settings-row shortcut-settings-row">
                  <span class="settings-label">{command.label}</span>
                  <div class="shortcut-settings-actions">
                    <button
                      class="settings-btn shortcut-capture"
                      classList={{ active: capturing() === command.id }}
                      onClick={() => {
                        setCapturing(command.id);
                        setError(null);
                      }}
                      onKeyDown={(e) => capturing() === command.id && capture(e, command.id)}
                    >
                      {capturing() === command.id
                        ? "Нажмите клавиши…"
                        : formatShortcut(effective()[command.id], isMac)}
                    </button>
                    <button
                      class="settings-btn"
                      title="Вернуть стандартное сочетание"
                      onClick={() => save(resetShortcutOverride(props.settings.shortcuts, command.id))}
                    >
                      По умолчанию
                    </button>
                  </div>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}
