export type CommandContext = "global" | "taskList" | "taskMenu";

export interface CommandDefinition {
  id: string;
  label: string;
  context: CommandContext;
  defaultShortcut: string | null;
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  { id: "palette", label: "Палитра команд", context: "global", defaultShortcut: "mod+k" },
  { id: "quickPage", label: "Перейти к странице", context: "global", defaultShortcut: "mod+p" },
  { id: "search", label: "Поиск", context: "global", defaultShortcut: "mod+f" },
  { id: "newTask", label: "Новая задача сегодня", context: "global", defaultShortcut: "mod+shift+t" },
  { id: "today", label: "Сегодняшний журнал", context: "global", defaultShortcut: "mod+j" },
  { id: "settings", label: "Настройки", context: "global", defaultShortcut: "mod+," },
  { id: "help", label: "Горячие клавиши", context: "global", defaultShortcut: "f1" },
  { id: "taskNext", label: "Следующая задача", context: "taskList", defaultShortcut: "j" },
  { id: "taskPrevious", label: "Предыдущая задача", context: "taskList", defaultShortcut: "k" },
  { id: "taskOpen", label: "Открыть источник задачи", context: "taskList", defaultShortcut: "enter" },
  { id: "taskEdit", label: "Редактировать задачу", context: "taskList", defaultShortcut: "e" },
  { id: "taskMenu", label: "Меню задачи", context: "taskList", defaultShortcut: "space" },
  { id: "taskToggleDone", label: "Выполнено / вернуть в работу", context: "taskList", defaultShortcut: "x" },
  { id: "urgencyLow", label: "Низкая срочность", context: "taskMenu", defaultShortcut: "1" },
  { id: "urgencyMedium", label: "Средняя срочность", context: "taskMenu", defaultShortcut: "2" },
  { id: "urgencyHigh", label: "Высокая срочность", context: "taskMenu", defaultShortcut: "3" },
  { id: "importanceLow", label: "Низкая важность", context: "taskMenu", defaultShortcut: "q" },
  { id: "importanceMedium", label: "Средняя важность", context: "taskMenu", defaultShortcut: "w" },
  { id: "importanceHigh", label: "Высокая важность", context: "taskMenu", defaultShortcut: "e" },
];
