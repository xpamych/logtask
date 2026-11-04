import type { TaskDto } from "./api";

export type TaskMenuChange =
  | { kind: "status"; value: string }
  | { kind: "priority"; value: string | null }
  | { kind: "urgency" | "importance"; value: string | null }
  | { kind: "deadline"; value: string | null }
  | { kind: "clockRunning"; value: boolean };

/** Локальное изменение карточки после успешной записи из открытого меню. */
export function applyTaskMenuChange(task: TaskDto, change: TaskMenuChange): TaskDto {
  if (change.kind === "status") {
    return {
      ...task,
      status: change.value,
      done: change.value === "DONE" || change.value === "CANCELED",
    };
  }
  if (change.kind === "priority") {
    return { ...task, priority: change.value === null ? null : `[#${change.value}]` };
  }
  return { ...task, [change.kind]: change.value };
}
