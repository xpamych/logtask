import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { BlockDto, Settings } from "~/lib/api";
import { blocksBatchApply, blocksMarkdownGet } from "~/lib/api";
import { blockDragStarted, pruneBlockSelection, selectBlock, selectedBlockUuids, extendBlockSelection, subtreeSelectionRange } from "~/lib/blockSelection";
import type { BlockSelectionState } from "~/lib/blockSelection";
import { blockChildrenSet, blockCollectionKeyAllowed, toggleCollapsed, visibleBlockUuids } from "~/lib/blockTree";
import { editingBlock } from "~/lib/editState";
import { BlockView } from "../BlockView";
import { BlockTreeLinks } from "./BlockTreeLinks";
import { treeActiveUuids, blockParentUuids } from "~/lib/blockTreeLinks";

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
  const [hoveredUuid, setHoveredUuid] = createSignal<string | null>(null);
  let container: HTMLDivElement | undefined;
  const visible = createMemo(() => visibleBlockUuids(props.blocks, collapsed()));
  const visibleSet = createMemo(() => new Set(visible()));
  const visibleBlocks = createMemo(() => props.blocks.filter((block) => visibleSet().has(block.uuid)));
  const selected = createMemo(() => selectedBlockUuids(selection(), visible()));
  const selectedSet = createMemo(() => new Set(selected()));
  const treeActive = createMemo(() => treeActiveUuids(props.blocks, hoveredUuid()));
  const childrenSet = createMemo(() => blockChildrenSet(props.blocks));
  const focusContainer = () => queueMicrotask(() => container?.focus());
  const select = (uuid: string, extend = false) => {
    setSelection((current) => extend
      ? extendBlockSelection(current ?? selectBlock(null, props.containerId, uuid), visible(), uuid)
      : selectBlock(current, props.containerId, uuid));
    focusContainer();
  };
  const selectAll = (uuid?: string) => {
    const ids = visible();
    if (!ids.length) return;
    const current = selection();
    if (current) {
      const selectedIds = selectedBlockUuids(current, ids);
      if (selectedIds.length === ids.length) return;
      const parent = blockParentUuids(props.blocks)[current.anchorUuid] ?? null;
      if (parent && ids.includes(parent)) {
        const range = subtreeSelectionRange(visibleBlocks(), parent);
        setSelection(range && ids.includes(range[1])
          ? { containerId: props.containerId, anchorUuid: range[0], focusUuid: range[1] }
          : selectBlock(current, props.containerId, parent));
        focusContainer();
        return;
      }
    } else if (uuid) {
      setSelection(selectBlock(null, props.containerId, uuid));
      focusContainer();
      return;
    }
    setSelection({ containerId: props.containerId, anchorUuid: ids[0], focusUuid: ids[ids.length - 1] });
    focusContainer();
  };
  onMount(() => {
    const onSelectionKey = (event: KeyboardEvent) => {
      if (!selection()) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectAll();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.getSelection()?.removeAllRanges();
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onSelectionKey, true);
    onCleanup(() => window.removeEventListener("keydown", onSelectionKey, true));
  });
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
    if (!selection() || event.isComposing || !blockCollectionKeyAllowed(editingBlock() !== null)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.shiftKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const ids = visible();
      const current = selection()!;
      const index = ids.indexOf(current.focusUuid);
      const target = ids[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (target) setSelection(extendBlockSelection(current, ids, target));
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation(); selectAll();
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
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    }
  };
  let pointerStart: { uuid: string; x: number; y: number } | null = null;
  let draggingSelection = false;
  const blockUuidAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.(".block")?.getAttribute("data-uuid") ?? null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || editingBlock() !== null) return;
    const uuid = blockUuidAt(event.target);
    if (uuid) pointerStart = { uuid, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointerStart || (event.buttons & 1) === 0) return;
    if (!draggingSelection && !blockDragStarted(pointerStart, { x: event.clientX, y: event.clientY })) return;
    const target = blockUuidAt(event.target);
    if (!target) return;
    event.preventDefault();
    if (!draggingSelection) {
      draggingSelection = true;
      select(pointerStart.uuid);
    }
    setSelection((current) => extendBlockSelection(current, visible(), target));
  };
  const onPointerUp = (event: PointerEvent) => {
    if (draggingSelection) event.preventDefault();
    draggingSelection = false;
    pointerStart = null;
  };
  return (
    <div
      ref={container}
      class="block-collection"
      tabindex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseOver={(event) => setHoveredUuid((event.target as Element).closest(".block")?.getAttribute("data-uuid") ?? null)}
      onMouseLeave={() => setHoveredUuid(null)}
    >
      <BlockTreeLinks container={container} blocks={props.blocks} activeUuids={treeActive()} version={collapsed()} />
      <For each={visibleBlocks()}>
        {(block, index) => (
          <BlockView
            block={block}
            deferred={index() > 50}
            firstBlock={props.blocks[0]?.uuid === block.uuid}
            onOpenPage={props.onOpenPage}
            onChanged={props.onChanged}
            onStatusChange={props.onStatusChange}
            onDelete={props.onDelete}
            onNavigate={props.onNavigate}
            settings={props.settings}
            selected={selectedSet().has(block.uuid)}
            treeActive={treeActive().has(block.uuid)}
            hasChildren={childrenSet().has(block.uuid)}
            collapsed={collapsed().has(block.uuid)}
            onToggleFold={() => setCollapsed(toggleCollapsed(collapsed(), block.uuid))}
            onSelect={(uuid, extend) => select(uuid, extend)}
            onSelectAll={selectAll}
            onCancelEdit={(uuid) => select(uuid)}
            onBeginEdit={() => setSelection(null)}
          />
        )}
      </For>
    </div>
  );
}
