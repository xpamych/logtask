export type AssetSave = (data: number[], mime: string) => Promise<string>;

const pending = new WeakSet<HTMLTextAreaElement>();

export function insertAtCursor(
  text: string,
  start: number,
  end: number,
  insertion: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, start) + insertion + text.slice(end),
    caret: start + insertion.length,
  };
}

export async function pasteImage(
  e: ClipboardEvent,
  textarea: HTMLTextAreaElement,
  save: AssetSave,
): Promise<{ handled: boolean; text?: string; caret?: number; error?: string }> {
  if (pending.has(textarea)) return { handled: true };
  const item = Array.from(e.clipboardData?.items ?? []).find((item) =>
    item.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (!item || !file) return { handled: false };
  e.preventDefault();
  pending.add(textarea);
  try {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const path = await save(bytes, file.type);
    const insertion = `![[../${path}]]`;
    return { handled: true, ...insertAtCursor(textarea.value, textarea.selectionStart, textarea.selectionEnd, insertion) };
  } catch (error) {
    return { handled: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    pending.delete(textarea);
  }
}
