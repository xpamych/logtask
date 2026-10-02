import { Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { SearchBar } from "~/components/SearchBar";

type Win = import("@tauri-apps/api/window").Window;

/** Верхняя полоса: кнопки панелей, поиск, управление окном (при выключенной
 * системной рамке). Полоса — drag-область окна. */
export function Topbar(props: {
  onOpenPage: (name: string) => void;
  sidebarCollapsed: boolean;
  panelCollapsed: boolean;
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
  systemTitlebar: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
}): JSX.Element {
  const [win, setWin] = createSignal<Win | null>(null);

  onMount(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      setWin(getCurrentWindow());
    } catch {
      // фронт вне Tauri (npm run dev) — кнопок окна нет
    }
  });

  return (
    <header class="topbar" data-tauri-drag-region>
      <button
        class="topbar-btn"
        classList={{ active: !props.sidebarCollapsed }}
        title={props.sidebarCollapsed ? "Показать левую панель" : "Скрыть левую панель"}
        onClick={props.onToggleSidebar}
      >
        ◧
      </button>
      <button
        class="topbar-btn"
        title="Назад"
        disabled={!props.canBack}
        onClick={props.onBack}
      >
        ←
      </button>
      <button
        class="topbar-btn"
        title="Вперёд"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        →
      </button>
      <button class="topbar-btn" title="К журналам" onClick={props.onHome}>
        ⌂
      </button>
      <div class="topbar-search">
        <SearchBar onOpenPage={props.onOpenPage} />
      </div>
      <button
        class="topbar-btn"
        classList={{ active: !props.panelCollapsed }}
        title={props.panelCollapsed ? "Показать правую панель" : "Скрыть правую панель"}
        onClick={props.onTogglePanel}
      >
        ◨
      </button>
      <Show when={!props.systemTitlebar && win()}>
        {(w) => (
          <div class="win-controls">
            <button class="topbar-btn" title="Свернуть" onClick={() => void w().minimize()}>
              —
            </button>
            <button
              class="topbar-btn"
              title="Развернуть / восстановить"
              onClick={() => void w().toggleMaximize()}
            >
              ▢
            </button>
            <button
              class="topbar-btn win-close"
              title="Закрыть"
              onClick={() => void w().close()}
            >
              ✕
            </button>
          </div>
        )}
      </Show>
    </header>
  );
}
