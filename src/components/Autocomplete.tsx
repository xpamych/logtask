import { For, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { blockRefCreate, blockRefsSearch, pageList } from "~/lib/api";
import { AutocompleteController } from "~/lib/autocomplete";
import type { AutocompleteItem } from "~/lib/autocomplete";

export function createAutocomplete(
  onAccept: (result: { text: string; caret: number }) => void,
  onError: (message: string) => void,
) {
  const [version, setVersion] = createSignal(0);
  const update = () => setVersion((value) => value + 1);
  const controller = new AutocompleteController({
    searchPages: async (query) => {
      const lower = query.toLowerCase();
      return (await pageList()).filter((name) => name.toLowerCase().includes(lower));
    },
    searchBlocks: async (query) =>
      (await blockRefsSearch(query, 6)).map((hit) => ({ id: hit.uuid, text: hit.text, page: hit.page })), 
    createRef: blockRefCreate,
    onAccept,
    onError,
  });
  return {
    get open() { version(); return controller.open; },
    get items() { version(); return controller.items; },
    get activeIndex() { version(); return controller.activeIndex; },
    onInput: async (text: string, caret: number) => {
      await controller.onInput(text, caret);
      update();
    },
    onKeyDown: async (event: KeyboardEvent) => {
      const handled = await controller.onKeyDown(event);
      update();
      return handled;
    },
    accept: async (item: AutocompleteItem) => {
      await controller.accept(item);
      update();
    },
  };
}

export function Autocomplete(props: {
  id: string;
  items: AutocompleteItem[];
  activeIndex: number;
  onAccept: (item: AutocompleteItem) => void;
}): JSX.Element {
  return (
    <div class="ac-list" id={props.id} role="listbox">
      <For each={props.items}>
        {(item, index) => (
          <button
            type="button"
            id={`${props.id}-${index()}`}
            role="option"
            aria-selected={index() === props.activeIndex}
            class="ac-item"
            classList={{ active: index() === props.activeIndex }}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onAccept(item);
            }}
          >
            <span>{item.text}</span>
            {item.page && <span class="ac-item-page">{item.page}</span>}
          </button>
        )}
      </For>
    </div>
  );
}
