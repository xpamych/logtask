import { For, Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { GlobalShortcutsStatus } from "~/lib/api";
import { globalShortcutsStatus, niriConfigWrite } from "~/lib/api";

const GLOBAL_SHORTCUTS = [
  { keys: "Ctrl+Alt+Space", label: "Показать Logtask" },
  { keys: "Ctrl+Alt+J", label: "Открыть сегодняшний журнал" },
  { keys: "Ctrl+Alt+N", label: "Создать задачу" },
];

export function BackendStatus(): JSX.Element {
  const [status, setStatus] = createSignal<GlobalShortcutsStatus | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [writing, setWriting] = createSignal(false);

  const refresh = async () => {
    try {
      setStatus(await globalShortcutsStatus());
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const writeNiriConfig = async () => {
    setWriting(true);
    try {
      await niriConfigWrite();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setWriting(false);
    }
  };

  onMount(() => void refresh());

  return (
    <section class="shortcut-settings-group" aria-label="Глобальные сочетания">
      <h2>Глобальные сочетания Wayland</h2>
      <For each={GLOBAL_SHORTCUTS}>
        {(shortcut) => (
          <div class="settings-row">
            <span class="settings-label">{shortcut.label}</span>
            <kbd>{shortcut.keys}</kbd>
          </div>
        )}
      </For>
      <Show when={status()}>
        {(current) => (
          <div class="settings-row">
            <span class="settings-label">
              Backend: {current().backend} · {current().status}
            </span>
            <Show when={current().backend === "Niri"}>
              <button class="settings-btn" disabled={writing()} onClick={() => void writeNiriConfig()}>
                {writing() ? "Создание…" : "Создать logtask.kdl"}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={status()?.message}>{(message) => <p>{message()}</p>}</Show>
      <Show when={status()?.backend === "Niri"}>
        <p>
          Добавьте в основной <code>config.kdl</code>: <code>include "logtask.kdl"</code>
        </p>
      </Show>
      <Show when={error()}>{(message) => <div class="error">{message()}</div>}</Show>
    </section>
  );
}
