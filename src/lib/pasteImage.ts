export type AssetSave = (data: number[], mime: string) => Promise<string>;

const pending = new WeakMap<HTMLTextAreaElement, Promise<unknown>>();

const SUPPORTED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/x-qt-image"]);

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

export function pasteImage(
  e: ClipboardEvent,
  textarea: HTMLTextAreaElement,
  save: AssetSave,
  nativeSave?: () => Promise<string | null>,
): Promise<{ handled: boolean; text?: string; caret?: number; error?: string }> {
  const current = pending.get(textarea);
  if (current) {
    e.preventDefault();
    return Promise.resolve({ handled: true });
  }
  const item = Array.from(e.clipboardData?.items ?? []).find((item) =>
    SUPPORTED_MIME.has(item.type),
  );
  const file = item?.getAsFile() ?? Array.from(e.clipboardData?.files ?? []).find((file) =>
    SUPPORTED_MIME.has(file.type),
  );
  if (!file && !nativeSave) return Promise.resolve({ handled: false });
  const operation = (async () => {
    try {
      const path = file
        ? await save(Array.from(new Uint8Array(await file.arrayBuffer())), file.type)
        : await nativeSave!();
      if (!path) return { handled: false };
      e.preventDefault();
      const insertion = `![[../${path}]]`;
      return { handled: true, ...insertAtCursor(textarea.value, textarea.selectionStart, textarea.selectionEnd, insertion) };
    } catch (error) {
      return { handled: true, error: error instanceof Error ? error.message : String(error) };
    } finally {
      pending.delete(textarea);
    }
  })();
  pending.set(textarea, operation);
  return operation;
}

export async function waitForImagePaste(textarea: HTMLTextAreaElement): Promise<void> {
  await pending.get(textarea);
}
