import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { COMMAND_DEFINITIONS } from "~/lib/commands";
import type { CommandContext } from "~/lib/commands";
import { effectiveShortcuts, formatShortcut } from "~/lib/shortcuts";

const GROUPS: { id: CommandContext; label: string }[] = [
  { id: "global", label: "Общие" },
  { id: "taskList", label: "Список задач" },
  { id: "taskMenu", label: "Меню задачи" },
];

export function ShortcutHelp(props: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
}): JSX.Element {
  const isMac = navigator.platform.includes("Mac");
  const effective = () => effectiveShortcuts(props.settings.shortcuts);

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <section
          class="modal shortcut-help"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-help-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="modal-head">
            <h2 id="shortcut-help-title" class="modal-title">Горячие клавиши</h2>
            <button class="modal-close" aria-label="Закрыть" onClick={props.onClose}>×</button>
          </div>
          <div class="modal-body">
            <For each={GROUPS}>
              {(group) => (
                <section>
                  <h3>{group.label}</h3>
                  <For each={COMMAND_DEFINITIONS.filter((command) => command.context === group.id)}>
                    {(command) => (
                      <div class="shortcut-help-row">
                        <span>{command.label}</span>
                        <kbd>{formatShortcut(effective()[command.id], isMac)}</kbd>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
            <p class="muted">Стрелки ↑/↓ также переключают выбранную задачу. Изменить сочетания можно в настройках.</p>
          </div>
        </section>
      </div>
    </Show>
  );
}
