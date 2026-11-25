export interface EditorKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
  code?: string;
}

export interface EditorKeyContext {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function selectAllAction(previousAt: number, _now: number): "text" | "block" {
  return previousAt > 0 ? "block" : "text";
}

export function canSaveBlock(state: { saving: boolean; editing: boolean }): boolean {
  return state.editing && !state.saving;
}

export function splitEditorSource(text: string, start: number, end: number): { before: string; after: string } {
  return { before: text.slice(0, start), after: text.slice(end) };
}

export type EditorCommand =
  | "split" | "save" | "cancel" | "indent" | "outdent" | "selectAllBlocks"
  | "mergeUp" | "mergeDown" | "navigateUp" | "navigateDown"
  | "bold" | "italic" | "strike" | "highlight" | "undo" | "redo";

export function toggleInlineMarkup(
  text: string,
  start: number,
  end: number,
  marker: string,
): { text: string; start: number; end: number } {
  const selected = text.slice(start, end);
  if (text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
    return {
      text: text.slice(0, start - marker.length) + selected + text.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + marker.length,
    end: end + marker.length,
  };
}

export function classifyEditorKey(
  event: EditorKeyEvent,
  context: EditorKeyContext,
): EditorCommand | null {
  if (event.isComposing || event.keyCode === 229) return null;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && (event.code === "KeyA" || event.key.toLowerCase() === "a")) return "selectAllBlocks";
  if (mod && event.code === "KeyZ") return event.shiftKey ? "redo" : "undo";
  if (mod && event.code === "KeyB") return "bold";
  if (mod && event.code === "KeyI") return "italic";
  if (mod && event.shiftKey && event.code === "KeyS") return "strike";
  if (mod && event.shiftKey && event.code === "KeyH") return "highlight";
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
