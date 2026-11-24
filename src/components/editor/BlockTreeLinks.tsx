import { For, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { BlockDto } from "~/lib/api";
import { blockParentUuids, treeLinkPath } from "~/lib/blockTreeLinks";

export function BlockTreeLinks(props: {
  container?: HTMLDivElement;
  blocks: BlockDto[];
  hoveredUuid: string | null;
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
      const point = (uuid: string) => {
        const circle = container.querySelector<HTMLElement>(`:scope > .block[data-uuid="${uuid}"] .status-prio-dot`);
        if (!circle) return null;
        const rect = circle.getBoundingClientRect();
        return {
          x: rect.left - root.left + rect.width / 2,
          y: rect.top - root.top + rect.height / 2,
          radius: rect.width / 2,
        };
      };
      setLinks(Object.entries(parents).flatMap(([uuid, parentUuid]) => {
        const parent = point(parentUuid);
        const child = point(uuid);
        return parent && child ? [{ uuid, d: treeLinkPath(parent, child) }] : [];
      }));
    });
  });
  return (
    <svg class="block-tree-links" aria-hidden="true">
      <For each={links()}>
        {(link) => <path classList={{ active: props.hoveredUuid === link.uuid }} d={link.d} />}
      </For>
    </svg>
  );
}
