import { For, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { BlockDto, Settings } from "~/lib/api";
import { blocksBatchApply, blocksMarkdownGet } from "~/lib/api";
import { pruneBlockSelection, selectBlock, selectedBlockUuids, extendBlockSelection } from "~/lib/blockSelection";
import type { BlockSelectionState } from "~/lib/blockSelection";
import { hasBlockChildren, toggleCollapsed, visibleBlockUuids } from "~/lib/blockTree";
import { BlockView } from "../BlockView";

export function BlockCollection(props: {
  containerId: string;
  blocks: BlockDto[];
  settings?: Settings | null;
  onOpenPage?: (name: string) => void;
  onChanged?: () => void;
  onStatusChange?: (uuid: string, marker: string) => Promise<string>;
  onDelete?: (uuid: string) => void | Promise<void>;
  onNavigate?: (uuid: string, dir: -1 | 1) => boolean;
  onError?: (message: string) => void;
}): JSX.Element {
  const [selection, setSelection] = createSignal<BlockSelectionState | null>(null);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set());
  let container: HTMLDivElement | undefined;
  const visible = () => visibleBlockUuids(props.blocks, collapsed());
  const selected = () => selectedBlockUuids(selection(), visible());
  const focusContainer = () => queueMicrotask(() => container?.focus());
  const select = (uuid: string, extend = false) => {
    setSelection((current) => extend
      ? extendBlockSelection(current ?? selectBlock(null, props.containerId, uuid), visible(), uuid)
      : selectBlock(current, props.containerId, uuid));
    focusContainer();
  };
  const selectAll = () => {
    const ids = visible();
    if (!ids.length) return;
    setSelection({ containerId: props.containerId, anchorUuid: ids[0], focusUuid: ids[ids.length - 1] });
    focusContainer();
  };
  createEffect(() => {
    setSelection(pruneBlockSelection(selection(), visible()));
  });
  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(await blocksMarkdownGet(selected()));
      return true;
    } catch (error) {
      props.onError?.(String(error));
      return false;
    }
  };
  const apply = async (operation: Parameters<typeof blocksBatchApply>[1], confirmDelete = false) => {
    const ids = selected();
    if (!ids.length) return;
    if (confirmDelete && !confirm(`Удалить выбранные блоки (${ids.length}) со всеми вложенными?`)) return;
    try {
      if (await blocksBatchApply(ids, operation)) {
        setSelection(null);
        props.onChanged?.();
      }
    } catch (error) {
      props.onError?.(String(error));
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!selection() || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.shiftKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const ids = visible();
      const current = selection()!;
      const index = ids.indexOf(current.focusUuid);
      const target = ids[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) setSelection(extendBlockSelection(current, ids, target));
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault(); selectAll();
    } else if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault(); void copy();
    } else if (mod && event.key.toLowerCase() === "x") {
      event.preventDefault(); void copy().then((ok) => { if (ok) void apply({ kind: "delete" }); });
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault(); void apply({ kind: "delete" }, true);
    } else if (mod && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault(); void apply({ kind: "move", direction: event.key === "ArrowUp" ? -1 : 1 });
    } else if (event.key === "Tab") {
      event.preventDefault(); void apply({ kind: "indent", direction: event.shiftKey ? -1 : 1 });
    } else if (event.key === "Escape") {
      setSelection(null);
    }
  };
  return (
    <div ref={container} class="block-collection" tabindex={-1} onKeyDown={onKeyDown}>
      <For each={props.blocks.filter((block) => visible().includes(block.uuid))}>
        {(block) => (
          <BlockView
            block={block}
            firstBlock={props.blocks[0]?.uuid === block.uuid}
            onOpenPage={props.onOpenPage}
            onChanged={props.onChanged}
            onStatusChange={props.onStatusChange}
            onDelete={props.onDelete}
            onNavigate={props.onNavigate}
            settings={props.settings}
            selected={selected().includes(block.uuid)}
            hasChildren={hasBlockChildren(props.blocks, block.uuid)}
            collapsed={collapsed().has(block.uuid)}
            onToggleFold={() => setCollapsed(toggleCollapsed(collapsed(), block.uuid))}
            onSelect={(uuid, extend) => select(uuid, extend)}
            onSelectAll={selectAll}
            onCancelEdit={(uuid) => select(uuid)}
          />
        )}
      </For>
    </div>
  );
}
