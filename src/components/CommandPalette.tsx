import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut: string | null;
  enabled: boolean;
  run: () => void;
}

export function CommandPalette(props: {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;
  let previousFocus: Element | null = null;
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    return props.commands.filter((command) => command.label.toLowerCase().includes(q));
  });

  createEffect(() => {
    if (!props.open) return;
    previousFocus = document.activeElement;
    setQuery("");
    setSelected(0);
    queueMicrotask(() => inputEl?.focus());
    onCleanup(() => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    });
  });

  createEffect(() => {
    if (selected() >= filtered().length) setSelected(Math.max(0, filtered().length - 1));
  });

  const run = (command: PaletteCommand) => {
    if (!command.enabled) return;
    props.onClose();
    command.run();
  };

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <section
          class="modal command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Палитра команд"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputEl}
            class="command-palette-input"
            aria-label="Команда или страница"
            placeholder="Команда или страница…"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                props.onClose();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setSelected((index) => Math.max(0, Math.min(filtered().length - 1, index + delta)));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const command = filtered()[selected()];
                if (command) run(command);
              }
            }}
          />
          <div class="command-palette-list" role="listbox">
            <For each={filtered()} fallback={<div class="muted command-palette-empty">Ничего не найдено</div>}>
              {(command, index) => (
                <button
                  class="command-palette-item"
                  classList={{ active: index() === selected() }}
                  disabled={!command.enabled}
                  role="option"
                  aria-selected={index() === selected()}
                  onMouseEnter={() => setSelected(index())}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  <kbd>{command.shortcut ?? ""}</kbd>
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
    </Show>
  );
}
