import { Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { EditorView } from "@codemirror/view";
import { assetSave, blockCreate, clipboardAssetSave } from "~/lib/api";
import { pasteImage, waitForImagePaste } from "~/lib/pasteImage";
import type { TextInputAdapter } from "~/lib/pasteImage";
import { Autocomplete, createAutocomplete } from "../Autocomplete";
import { BlockEditor } from "./BlockEditor";

export function BlockComposer(props: {
  page: string;
  marker: "TODO" | null;
  onCreated: () => void | Promise<void>;
  onClose: () => void;
  onError?: (message: string) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal("");
  const [pasteBusy, setPasteBusy] = createSignal(false);
  const [pasteError, setPasteError] = createSignal<string | null>(null);
  let editorView: EditorView | undefined;
  const inputAdapter: TextInputAdapter = {
    get value() { return editorView?.state.doc.toString() ?? draft(); },
    get selectionStart() { return editorView?.state.selection.main.from ?? 0; },
    get selectionEnd() { return editorView?.state.selection.main.to ?? 0; },
  };
  const autocomplete = createAutocomplete(({ text, caret }) => {
    setDraft(text);
    queueMicrotask(() => {
      if (!editorView) return;
      editorView.focus();
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: text }, selection: { anchor: caret } });
    });
  }, setPasteError);

  const submit = async (keepOpen: boolean) => {
    const text = (editorView?.state.doc.toString() ?? draft()).trim();
    if (!text) {
      if (!keepOpen) props.onClose();
      return;
    }
    if (editorView) await waitForImagePaste(inputAdapter);
    try {
      await blockCreate(props.page, text, props.marker);
      await props.onCreated();
      if (keepOpen && editorView) {
        setDraft("");
        editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: "" } });
        editorView.focus();
      } else {
        props.onClose();
      }
    } catch (error) {
      props.onError?.(String(error));
    }
  };
  const onPaste = async (event: ClipboardEvent) => {
    if (!editorView) return;
    setPasteError(null);
    setPasteBusy(true);
    const result = await pasteImage(event, inputAdapter, assetSave, clipboardAssetSave);
    setPasteBusy(false);
    if (result.error) {
      setPasteError(result.error);
      return;
    }
    if (result.text !== undefined && result.caret !== undefined) {
      setDraft(result.text);
      editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: result.text }, selection: { anchor: result.caret } });
    }
  };
  return (
    <div class="block composer-row">
      <span class="status-prio-dot empty" />
      <div class="block-content">
        <BlockEditor
          ref={(view) => { editorView = view ?? undefined; }}
          initialValue=""
          initialAnchor={0}
          mode="live"
          onDraft={(text) => {
            setDraft(text);
            void autocomplete.onInput(text, editorView?.state.selection.main.from ?? 0);
          }}
          onSave={() => void submit(false)}
          onCancel={props.onClose}
          onSplit={() => void submit(true)}
          onIndent={() => undefined}
          onMerge={() => undefined}
          onNavigate={() => false}
          onSelectAll={() => undefined}
          onPaste={(event) => void onPaste(event)}
          onKeyDown={(event) => {
            if (!autocomplete.open || !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return false;
            event.preventDefault();
            void autocomplete.onKeyDown(event);
            return true;
          }}
        />
        <Show when={pasteBusy()}><div class="muted">Сохранение изображения…</div></Show>
        <Show when={pasteError()}>{(message) => <div class="error">{message()}</div>}</Show>
        <Show when={autocomplete.open}>
          <Autocomplete
            id={`composer-autocomplete-${props.page}`}
            items={autocomplete.items}
            activeIndex={autocomplete.activeIndex}
            onAccept={(item) => void autocomplete.accept(item)}
          />
        </Show>
      </div>
    </div>
  );
}
