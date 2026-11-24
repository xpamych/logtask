export interface EditorKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export interface EditorKeyContext {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function canSaveBlock(state: { saving: boolean; editing: boolean }): boolean {
  return state.editing && !state.saving;
}

export function splitEditorSource(text: string, start: number, end: number): { before: string; after: string } {
  return { before: text.slice(0, start), after: text.slice(end) };
}

export type EditorCommand =
  | "split" | "save" | "cancel" | "indent" | "outdent" | "selectAllBlocks"
  | "mergeUp" | "mergeDown" | "navigateUp" | "navigateDown";

export function classifyEditorKey(
  event: EditorKeyEvent,
  context: EditorKeyContext,
): EditorCommand | null {
  if (event.isComposing || event.keyCode === 229) return null;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === "a") return "selectAllBlocks";
  if (event.key === "Escape") return "cancel";
  if (event.key === "Tab") return event.shiftKey ? "outdent" : "indent";
  if (event.key === "Enter" && !event.shiftKey) return mod ? "save" : "split";
  if (event.altKey || mod || event.shiftKey) return null;
  const collapsed = context.selectionStart === context.selectionEnd;
  if (event.key === "Backspace" && collapsed && context.selectionStart === 0) return "mergeUp";
  if (event.key === "Delete" && collapsed && context.selectionStart === context.value.length) return "mergeDown";
  if (event.key === "ArrowUp" && !context.value.slice(0, context.selectionStart).includes("\n")) return "navigateUp";
  if (event.key === "ArrowDown" && !context.value.slice(context.selectionEnd).includes("\n")) return "navigateDown";
  return null;
}
