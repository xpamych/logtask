import { completeAutocomplete, findAutocompleteContext, type AutocompleteContext } from "./blockRefs.ts";

export interface AutocompleteItem {
  id: string;
  text: string;
  page?: string;
}

interface AutocompleteOptions {
  searchPages: (query: string) => Promise<string[]>;
  searchBlocks: (query: string) => Promise<AutocompleteItem[]>;
  createRef: (uuid: string) => Promise<{ ref: string; uuid: string }>;
  onAccept: (result: { text: string; caret: number }) => void;
  onError: (message: string) => void;
  debounceMs?: number;
}

interface KeyEventLike {
  key: string;
  preventDefault: () => void;
}

export class AutocompleteController {
  items: AutocompleteItem[] = [];
  open = false;
  activeIndex = 0;
  private context: AutocompleteContext | null = null;
  private text = "";
  private epoch = 0;
  private accepting = false;
  private readonly debounceMs: number;
  private readonly options: AutocompleteOptions;

  constructor(options: AutocompleteOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? 150;
  }

  async onInput(text: string, caret: number): Promise<void> {
    this.text = text;
    this.context = findAutocompleteContext(text, caret);
    const context = this.context;
    const epoch = ++this.epoch;
    this.close();
    if (!context || (context.kind === "block" && context.query.trim() === "")) return;
    if (context.kind === "block" && this.debounceMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.debounceMs));
    }
    if (epoch !== this.epoch) return;
    try {
      const items = context.kind === "page"
        ? (await this.options.searchPages(context.query)).slice(0, 6).map((name) => ({ id: name, text: name }))
        : (await this.options.searchBlocks(context.query)).slice(0, 6);
      if (epoch !== this.epoch) return;
      this.items = items;
      this.activeIndex = 0;
      this.open = items.length > 0;
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.close();
      this.options.onError(error instanceof Error ? error.message : String(error));
    }
  }

  onKeyDown(event: KeyEventLike): boolean | Promise<boolean> {
    if (!this.open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.activeIndex = (this.activeIndex + direction + this.items.length) % this.items.length;
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.epoch++;
      this.close();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      return this.accept(this.items[this.activeIndex]).then(() => true);
    }
    return false;
  }

  async accept(item: AutocompleteItem): Promise<void> {
    const context = this.context;
    if (!context || this.accepting) return;
    const text = this.text;
    const epoch = ++this.epoch;
    this.accepting = true;
    this.close();
    try {
      const replacement = context.kind === "page"
        ? `[[${item.text}]]`
        : (await this.options.createRef(item.id)).ref;
      if (epoch !== this.epoch || text !== this.text) return;
      const result = completeAutocomplete(text, context, replacement);
      this.options.onAccept(result);
    } catch (error) {
      if (epoch === this.epoch) {
        this.options.onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.accepting = false;
    }
  }

  private close(): void {
    this.open = false;
    this.items = [];
    this.activeIndex = 0;
  }
}
