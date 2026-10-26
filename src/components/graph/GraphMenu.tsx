import { Show } from "solid-js";
import type { SceneNode } from "~/lib/graph/model";

export interface GraphMenuState {
  node: SceneNode;
  x: number;
  y: number;
  pinned: boolean;
}

export function GraphMenu(props: {
  menu: GraphMenuState;
  onClose: () => void;
  onOpenPage: (name: string) => void;
  onOpenAsset: (path: string) => void;
  onRevealAsset: (path: string) => void;
  onCopyLink: (name: string) => void;
  onPin: (pinned: boolean) => void;
  onHide: (id: string) => void;
  onToggleCluster: (id: string) => void;
}) {
  const act = (callback: () => void) => () => {
    callback();
    props.onClose();
  };
  return (
    <>
      <div class="menu-backdrop" onClick={props.onClose} />
      <div
        class="graph-node-menu"
        role="menu"
        style={{ left: `${props.menu.x}px`, top: `${props.menu.y}px` }}
      >
        <Show when={props.menu.node.kind === "cluster"}>
          <button type="button" role="menuitem" onClick={act(() => props.onToggleCluster(props.menu.node.id))}>
            Развернуть/свернуть
          </button>
        </Show>
        <Show when={props.menu.node.kind !== "cluster" && props.menu.node.kind !== "asset"}>
          <button type="button" role="menuitem" onClick={act(() => props.onOpenPage(props.menu.node.title))}>Открыть страницу</button>
          <button type="button" role="menuitem" onClick={act(() => props.onCopyLink(props.menu.node.title))}>Скопировать [[ссылку]]</button>
        </Show>
        <Show when={props.menu.node.kind === "asset"}>
          <button type="button" role="menuitem" onClick={act(() => props.onOpenAsset(props.menu.node.assetPath!))}>Открыть файл</button>
          <button type="button" role="menuitem" onClick={act(() => props.onRevealAsset(props.menu.node.assetPath!))}>Показать в файловом менеджере</button>
        </Show>
        <Show when={props.menu.node.kind !== "cluster"}>
          <button type="button" role="menuitem" onClick={act(() => props.onPin(!props.menu.pinned))}>
            {props.menu.pinned ? "Отпустить узел" : "Зафиксировать узел"}
          </button>
          <button type="button" role="menuitem" onClick={act(() => props.onHide(props.menu.node.id))}>Скрыть узел</button>
        </Show>
      </div>
    </>
  );
}
