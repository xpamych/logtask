import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { BlockDto } from "~/lib/api";
import { blockParentUuids, treeLinkPath } from "~/lib/blockTreeLinks";

export function BlockTreeLinks(props: {
  container?: HTMLDivElement;
  blocks: BlockDto[];
  activeUuids: ReadonlySet<string>;
  version: unknown;
}): JSX.Element {
  const [links, setLinks] = createSignal<{ uuid: string; d: string }[]>([]);
  const [measureVersion, setMeasureVersion] = createSignal(0);
  onMount(() => {
    if (!props.container) return;
    const observer = new ResizeObserver(() => setMeasureVersion((version) => version + 1));
    observer.observe(props.container);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    void measureVersion();
    void props.version;
    void props.blocks;
    queueMicrotask(() => {
      const container = props.container;
      if (!container) return;
      const parents = blockParentUuids(props.blocks);
      const root = container.getBoundingClientRect();
      const points = new Map<string, { x: number; y: number; radius: number }>();
      container.querySelectorAll<HTMLElement>(":scope > .block[data-uuid]").forEach((block) => {
        const circle = block.querySelector<HTMLElement>(".status-prio-dot");
        if (!circle) return;
        const rect = circle.getBoundingClientRect();
        points.set(block.dataset.uuid!, {
          x: rect.left - root.left + rect.width / 2,
          y: rect.top - root.top + rect.height / 2,
          radius: rect.width / 2,
        });
      });
      setLinks(Object.entries(parents).flatMap(([uuid, parentUuid]) => {
        const parent = points.get(parentUuid);
        const child = points.get(uuid);
        return parent && child ? [{ uuid, d: treeLinkPath(parent, child) }] : [];
      }));
    });
  });
  return (
    <svg class="block-tree-links" aria-hidden="true">
      <For each={links()}>
        {(link) => <path d={link.d} />}
      </For>
      <For each={links().filter((link) => props.activeUuids.has(link.uuid))}>
        {(link) => <path class="active" d={link.d} />}
      </For>
    </svg>
  );
}
