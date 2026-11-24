import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { classifyEditorKey } from "./editorCommands";

export function BlockEditor(props: {
  initialValue: string;
  initialAnchor: number;
  mode: "live" | "source";
  onDraft: (text: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onSplit: (text: string, start: number, end: number) => void;
  onIndent: (out: boolean, at: number) => void;
  onMerge: (direction: -1 | 1) => void;
  onNavigate: (direction: -1 | 1) => boolean;
  onSelectAll: () => void;
  onPaste?: (event: ClipboardEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
  ref?: (view: EditorView | null) => void;
}): JSX.Element {
  void props.mode;
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  onMount(() => {
    const run = (event: KeyboardEvent): boolean => {
      if (!view || event.isComposing || event.keyCode === 229) return false;
      if (props.onKeyDown?.(event)) return true;
      const command = classifyEditorKey(event, {
        value: view.state.doc.toString(),
        selectionStart: view.state.selection.main.from,
        selectionEnd: view.state.selection.main.to,
      });
      if (!command) return false;
      if (command === "navigateUp" || command === "navigateDown") {
        return props.onNavigate(command === "navigateUp" ? -1 : 1);
      }
      event.preventDefault();
      event.stopPropagation();
      const selection = view.state.selection.main;
      const text = view.state.doc.toString();
      switch (command) {
        case "split": props.onSplit(text, selection.from, selection.to); break;
        case "save": props.onSave(text); break;
        case "cancel": props.onCancel(); break;
        case "indent": props.onIndent(false, selection.from); break;
        case "outdent": props.onIndent(true, selection.from); break;
        case "selectAllBlocks": props.onSelectAll(); break;
        case "mergeUp": props.onMerge(-1); break;
        case "mergeDown": props.onMerge(1); break;
      }
      return true;
    };
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.initialValue,
        selection: { anchor: Math.min(props.initialAnchor, props.initialValue.length) },
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Текст блока" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) props.onDraft(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown: (event) => { run(event); },
            blur: () => props.onSave(view?.state.doc.toString() ?? ""),
            paste: (event) => props.onPaste?.(event),
          }),
        ],
      }),
    });
    props.ref?.(view);
    view.focus();
  });
  onCleanup(() => {
    props.ref?.(null);
    view?.destroy();
  });
  return <div ref={host} class="block-cm" />;
}
