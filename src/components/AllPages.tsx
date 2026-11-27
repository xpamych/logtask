import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import {
  clipboardTextWrite,
  pageCreate,
  pageDirectoryCreate,
  pagePathGet,
  pageTree,
} from "~/lib/api";
import {
  buildPageTree,
  readExpandedDirs,
  revealPath,
  writeExpandedDirs,
} from "~/lib/pageTree";
import type { PageTreeNode } from "~/lib/pageTree";
import { IconStar } from "~/components/icons";

interface CommonProps {
  favorites: string[];
  expanded: Set<string>;
  graphName: string;
  onOpenPage: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onToggleDirectory: (path: string, open: boolean) => void;
  onMenu: (kind: "directory" | "page", path: string, button: HTMLButtonElement) => void;
}

function TreeNode(props: CommonProps & { node: PageTreeNode }): JSX.Element {
  const isFav = () => props.favorites.includes(props.node.path);
  if (props.node.kind === "directory") {
    return (
      <details
        class="allpages-directory"
        open={props.expanded.has(props.node.path)}
        onToggle={(event) => props.onToggleDirectory(props.node.path, event.currentTarget.open)}
      >
        <summary>
          <span class="allpages-directory-name">{props.node.name}</span>
        </summary>
        <button
          type="button"
          class="star-btn allpages-more allpages-directory-more"
          aria-label={`Действия с каталогом ${props.node.name}`}
          onClick={(event) => props.onMenu("directory", props.node.path, event.currentTarget)}
        >
          ⋯
        </button>
        <div class="allpages-children">
          <For each={props.node.children}>
            {(child) => <TreeNode {...props} node={child} />}
          </For>
        </div>
      </details>
    );
  }
  return (
    <div class="allpages-row">
      <button
        type="button"
        class="star-btn"
        classList={{ active: isFav() }}
        aria-label={isFav() ? `Убрать ${props.node.name} из избранного` : `Добавить ${props.node.name} в избранное`}
        onClick={() => props.onToggleFavorite(props.node.path)}
      >
        <IconStar size={14} filled={isFav()} />
      </button>
      <button
        type="button"
        class="page-item allpages-link"
        title={props.node.path}
        onClick={() => props.onOpenPage(props.node.path)}
      >
        {props.node.name}
      </button>
      <button
        type="button"
        class="star-btn allpages-more"
        aria-label={`Действия со страницей ${props.node.name}`}
        onClick={(event) => props.onMenu("page", props.node.path, event.currentTarget)}
      >
        ⋯
      </button>
    </div>
  );
}

/** Центральный вид «Все страницы»: дерево каталогов и страниц графа. */
export function AllPages(props: {
  graphRoot: string;
  refreshKey: number;
  pages: string[];
  favorites: string[];
  onOpenPage: (name: string) => void;
  onToggleFavorite: (name: string) => void;
  onToast: (text: string) => void;
}): JSX.Element {
  const [directories, setDirectories] = createSignal<string[]>([]);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [menu, setMenu] = createSignal<{ kind: "directory" | "page"; path: string; x: number; y: number } | null>(null);
  const [creation, setCreation] = createSignal<{ kind: "directory" | "page"; directory: string } | null>(null);
  const [draft, setDraft] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let dialogEl: HTMLDialogElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  const graphName = createMemo(() => props.graphRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Граф");
  const loadDirectories = async () => {
    try {
      setDirectories((await pageTree()).directories);
    } catch (reason) {
      props.onToast(String(reason));
    }
  };
  createEffect(on(() => props.graphRoot, () => {
    setExpanded(readExpandedDirs(localStorage, props.graphRoot, graphName()));
    void loadDirectories();
  }));
  createEffect(on(() => props.refreshKey, () => void loadDirectories()));
  createEffect(() => {
    if (!creation()) return;
    queueMicrotask(() => {
      if (!dialogEl?.open) dialogEl?.showModal();
      inputEl?.focus();
    });
  });

  const closeMenuOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") setMenu(null);
  };
  window.addEventListener("keydown", closeMenuOnEscape);
  onCleanup(() => window.removeEventListener("keydown", closeMenuOnEscape));

  const tree = createMemo(() => buildPageTree({ pages: props.pages, directories: directories() }, graphName()));
  const localDirectory = (path: string) => path === graphName() ? "" : path.slice(graphName().length + 1);
  const saveExpanded = (next: Set<string>) => {
    setExpanded(next);
    writeExpandedDirs(localStorage, props.graphRoot, next);
  };
  const openCreation = (kind: "directory" | "page", directory: string) => {
    setMenu(null);
    setDraft("");
    setError("");
    setCreation({ kind, directory });
  };
  const closeCreation = () => {
    setCreation(null);
    dialogEl?.close();
  };
  const submitCreation = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = creation();
    const name = draft().trim();
    if (!current || !name || busy()) return;
    setBusy(true);
    setError("");
    try {
      const canonicalDirectory = current.directory
        ? `${graphName()}/${current.directory}`
        : graphName();
      if (current.kind === "directory") {
        const path = current.directory ? `${current.directory}/${name}` : name;
        await pageDirectoryCreate(path);
        saveExpanded(revealPath(new Set(expanded()), `${graphName()}/${path}`));
      } else {
        const page = await pageCreate(name, current.directory);
        saveExpanded(revealPath(new Set(expanded()), canonicalDirectory));
        props.onOpenPage(page.name);
      }
      await loadDirectories();
      closeCreation();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const copyPath = async (name: string) => {
    setMenu(null);
    try {
      const path = await pagePathGet(name);
      await clipboardTextWrite(path);
      props.onToast(`Путь скопирован: ${path}`);
    } catch (reason) {
      props.onToast(String(reason));
    }
  };

  return (
    <main class="journal allpages">
      <div class="allpages-header">
        <h2 class="day-title">Все страницы ({props.pages.length})</h2>
      </div>
      <div class="allpages-list">
        <TreeNode
          node={tree()}
          favorites={props.favorites}
          expanded={expanded()}
          graphName={graphName()}
          onOpenPage={props.onOpenPage}
          onToggleFavorite={props.onToggleFavorite}
          onToggleDirectory={(path, open) => {
            const next = new Set(expanded());
            if (open) next.add(path); else next.delete(path);
            saveExpanded(next);
          }}
          onMenu={(kind, path, button) => {
            const rect = button.getBoundingClientRect();
            setMenu(menu()?.path === path ? null : { kind, path, x: rect.right, y: rect.bottom + 4 });
          }}
        />
      </div>
      <Show when={menu()}>
        {(current) => (
          <>
            <div class="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }} />
            <div
              class="block-menu ctx-menu page-menu"
              style={{ left: "auto", right: `${window.innerWidth - current().x}px`, top: `${current().y}px` }}
            >
              <Show when={current().kind === "directory"} fallback={
                <button type="button" class="page-menu-item" onClick={() => void copyPath(current().path)}>
                  Скопировать путь
                </button>
              }>
                <button type="button" class="page-menu-item" onClick={() => openCreation("page", localDirectory(current().path))}>
                  Новая страница
                </button>
                <button type="button" class="page-menu-item" onClick={() => openCreation("directory", localDirectory(current().path))}>
                  Новый подкаталог
                </button>
              </Show>
            </div>
          </>
        )}
      </Show>
      <Show when={creation()}>
        {(current) => (
          <dialog
            ref={dialogEl}
            class="allpages-dialog"
            aria-labelledby="allpages-create-title"
            onCancel={() => setCreation(null)}
            onClose={() => setCreation(null)}
          >
            <form onSubmit={(event) => void submitCreation(event)}>
              <h2 id="allpages-create-title">{current().kind === "page" ? "Новая страница" : "Новый каталог"}</h2>
              <p class="allpages-dialog-context">Каталог: {current().directory || graphName()}</p>
              <label for="allpages-create-name">{current().kind === "page" ? "Название страницы" : "Название каталога"}</label>
              <input
                id="allpages-create-name"
                ref={inputEl}
                name="name"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
                required
                autofocus
              />
              <p class="form-error" aria-live="polite">{error()}</p>
              <div class="allpages-dialog-actions">
                <button type="button" class="btn" onClick={closeCreation}>Отмена</button>
                <button type="submit" class="btn primary" disabled={busy()}>
                  {busy() ? "Создание…" : "Создать"}
                </button>
              </div>
            </form>
          </dialog>
        )}
      </Show>
    </main>
  );
}
