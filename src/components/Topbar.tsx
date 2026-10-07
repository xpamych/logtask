import { Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { SearchBar } from "~/components/SearchBar";
import {
  IconArrowLeft,
  IconArrowRight,
  IconHome,
  IconMaximize,
  IconMinimize,
  IconPanelLeft,
  IconPanelRight,
  IconRefresh,
  IconX,
} from "~/components/icons";

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
  /** ручная синхронизация интеграций */
  onSync: () => void;
  syncing: boolean;
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
        <IconPanelLeft />
      </button>
      <button
        class="topbar-btn"
        title="Назад"
        disabled={!props.canBack}
        onClick={props.onBack}
      >
        <IconArrowLeft />
      </button>
      <button
        class="topbar-btn"
        title="Вперёд"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <IconArrowRight />
      </button>
      <button class="topbar-btn" title="Домой" onClick={props.onHome}>
        <IconHome />
      </button>
      <button
        class="topbar-btn sync-btn"
        classList={{ spin: props.syncing }}
        title="Синхронизировать задачи из интеграций"
        onClick={props.onSync}
      >
        <IconRefresh />
      </button>
      {/* контейнер поиска занимает всю ширину между кнопками — он тоже
          drag-область (сам input остаётся кликабельным: Tauri проверяет
          атрибут только на непосредственной цели mousedown) */}
      <div class="topbar-search" data-tauri-drag-region>
        <SearchBar onOpenPage={props.onOpenPage} />
      </div>
      <button
        class="topbar-btn"
        classList={{ active: !props.panelCollapsed }}
        title={props.panelCollapsed ? "Показать правую панель" : "Скрыть правую панель"}
        onClick={props.onTogglePanel}
      >
        <IconPanelRight />
      </button>
      <Show when={!props.systemTitlebar && win()}>
        {(w) => (
          <div class="win-controls">
            <button class="topbar-btn" title="Свернуть" onClick={() => void w().minimize()}>
              <IconMinimize />
            </button>
            <button
              class="topbar-btn"
              title="Развернуть / восстановить"
              onClick={() => void w().toggleMaximize()}
            >
              <IconMaximize />
            </button>
            <button
              class="topbar-btn win-close"
              title="Закрыть"
              onClick={() => void w().close()}
            >
              <IconX />
            </button>
          </div>
        )}
      </Show>
    </header>
  );
}
