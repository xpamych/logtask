import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { Settings } from "~/lib/api";
import { editingBlock } from "~/lib/editState";
import { activeModalContext } from "~/lib/modalState";
import { commandForContext, effectiveShortcuts, normalizeShortcut, shouldHandleGlobalShortcut } from "~/lib/shortcuts";
import { selectedTaskUuid, setSelectedTaskUuid, visibleTaskUuid } from "~/lib/taskNavigation";
import { Kanban } from "./Kanban";
import { Matrix } from "./Matrix";
import { Queries } from "./Queries";

const MODES = ["Подборки", "Доска"] as const;
type Mode = (typeof MODES)[number];

const BOARD_VIEWS = ["Канбан", "Матрица"] as const;
type BoardView = (typeof BOARD_VIEWS)[number];

const MODE_KEY = "logtask:tasksMode";
const BOARD_KEY = "logtask:boardView";

function loadMode(): Mode {
  const saved = localStorage.getItem(MODE_KEY) ?? "";
  if ((MODES as readonly string[]).includes(saved)) return saved as Mode;
  // миграция со старых значений («Канбан»/«Матрица» были отдельными вкладками)
  if ((BOARD_VIEWS as readonly string[]).includes(saved)) return "Доска";
  return "Подборки";
}

function loadBoardView(): BoardView {
  const saved = localStorage.getItem(BOARD_KEY) ?? "";
  return (BOARD_VIEWS as readonly string[]).includes(saved)
    ? (saved as BoardView)
    : "Канбан";
}

/** Страница «Задачи»: подборки (по умолчанию) и доска (канбан/матрица) */
export function TasksPage(props: {
  refreshKey: number;
  settings?: Settings | null;
  onOpenPage: (name: string, uuid?: string) => void;
}): JSX.Element {
  const [mode, setMode] = createSignal<Mode>(loadMode());
  const [boardView, setBoardView] = createSignal<BoardView>(loadBoardView());

  const switchMode = (m: Mode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };

  const switchBoardView = (v: BoardView) => {
    setBoardView(v);
    localStorage.setItem(BOARD_KEY, v);
  };

  onMount(() => {
    const isMac = navigator.platform.includes("Mac");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || editingBlock() !== null || activeModalContext()) return;
      const selected = selectedTaskUuid();
      if (selected && document.querySelector(`[data-task-uuid="${CSS.escape(selected)}"]`)) return;
      const shortcut = normalizeShortcut(e, isMac);
      if (!shortcut || !shouldHandleGlobalShortcut(e.target, shortcut)) return;
      const effective = effectiveShortcuts(props.settings?.shortcuts ?? {});
      const id = commandForContext(shortcut, effective, "taskList");
      const direction = e.code === "ArrowDown" || id === "taskNext" ? 1 : e.code === "ArrowUp" || id === "taskPrevious" ? -1 : null;
      if (!direction) return;
      const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-task-uuid]"));
      const uuid = visibleTaskUuid(elements, direction, selected);
      if (!uuid) return;
      e.preventDefault();
      setSelectedTaskUuid(uuid);
      document.querySelector<HTMLElement>(`[data-task-uuid="${CSS.escape(uuid)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <main class="tasks-page">
      <div class="tabs tasks-modes">
        <For each={MODES}>
          {(m) => (
            <button
              class="tab"
              classList={{ active: mode() === m }}
              onClick={() => switchMode(m)}
            >
              {m}
            </button>
          )}
        </For>
      </div>
      <div class="tasks-body">
        <Show
          when={mode() === "Доска"}
          fallback={
            <Queries
              refreshKey={props.refreshKey}
              settings={props.settings}
              onOpenPage={props.onOpenPage}
            />
          }
        >
          <div class="board-switch">
            <For each={BOARD_VIEWS}>
              {(v) => (
                <button
                  class="board-switch-btn"
                  classList={{ active: boardView() === v }}
                  onClick={() => switchBoardView(v)}
                >
                  {v}
                </button>
              )}
            </For>
          </div>
          <Show
            when={boardView() === "Канбан"}
            fallback={
              <Matrix
                refreshKey={props.refreshKey}
                onOpenPage={props.onOpenPage}
                settings={props.settings}
              />
            }
          >
            <Kanban
              refreshKey={props.refreshKey}
              onOpenPage={props.onOpenPage}
              settings={props.settings}
            />
          </Show>
        </Show>
      </div>
    </main>
  );
}
