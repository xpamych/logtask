import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphLayoutEntry, GraphViewSettings } from "~/lib/api";
import { assetOpen, assetReveal, visualGraphLayoutGet } from "~/lib/api";
import { mergeLayout } from "~/lib/graph/layout";
import { startLayoutWorker } from "~/lib/graph/layout";
import type { SceneGraph } from "~/lib/graph/model";
import type { CameraState } from "~/lib/graph/persistence";
import { nextGraphFocusIndex } from "~/lib/graph/selection";
import { GraphMenu } from "./GraphMenu";
import type { GraphMenuState } from "./GraphMenu";
import { WebGlRenderer } from "./WebGlRenderer";

export function GraphCanvas(props: {
  scene: SceneGraph;
  settings: GraphViewSettings;
  scope: string;
  focusId?: string;
  resetLayoutKey?: number;
  initialCamera?: CameraState | null;
  highlight?: Set<string>;
  onOpenPage: (name: string) => void;
  onSelectNode?: (id: string | null) => void;
  onToggleCluster?: (id: string) => void;
  onHideNode?: (id: string) => void;
  onPositions?: (entries: GraphLayoutEntry[]) => void;
  onCameraChange?: (camera: { x: number; y: number; zoom: number }) => void;
}) {
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let labels!: HTMLCanvasElement;
  let renderer: WebGlRenderer | undefined;
  let worker: ReturnType<typeof startLayoutWorker> | undefined;
  let positions: GraphLayoutEntry[] = [];
  let saved: GraphLayoutEntry[] = [];
  let initialized = false;
  let visible = true;
  const [menu, setMenu] = createSignal<GraphMenuState | null>(null);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [focusIndex, setFocusIndex] = createSignal(0);

  const update = () => {
    if (!initialized || !worker) return;
    const ids = props.scene.nodes.map((node) => node.id);
    const base = positions.length > 0 ? positions : saved;
    const entries = mergeLayout(ids, base);
    positions = entries;
    renderer?.setPositions(entries);
    worker.update(
      ids,
      props.scene.edges.map((edge) => ({ source: edge.source, target: edge.target })),
      entries,
      props.settings,
    );
  };

  createEffect(() => {
    const scene = props.scene;
    const settings = props.settings;
    renderer?.setScene(scene, settings);
    if (initialized) update();
  });

  createEffect(() => {
    if (props.focusId) renderer?.centerOn(props.focusId);
  });

  createEffect(() => {
    const camera = props.initialCamera;
    if (camera) renderer?.setCamera(camera);
  });

  createEffect(() => {
    if (props.resetLayoutKey === undefined) return;
    positions = [];
    saved = [];
    update();
  });

  createEffect(() => {
    renderer?.setHighlight(props.highlight ?? new Set(), hovered());
  });

  onMount(() => {
    try {
      renderer = new WebGlRenderer(canvas, labels);
      renderer.setScene(props.scene, props.settings);
      renderer.onCameraChange = (camera) => props.onCameraChange?.(camera);
      worker = startLayoutWorker({
        onPositions: (entries) => {
          positions = entries;
          renderer?.setPositions(entries);
          props.onPositions?.(entries);
        },
        onSettled: () => props.onPositions?.(positions),
      });
      initialized = true;
      void visualGraphLayoutGet(props.scope)
        .catch(() => [])
        .then((entries) => {
          saved = entries;
          update();
          if (entries.length === 0) renderer?.fit();
        });
    } catch (error) {
      console.error(error);
      container.dataset.error = error instanceof Error ? error.message : String(error);
    }

    const pause = () => worker?.pause();
    const resume = () => {
      if (visible && !document.hidden) worker?.resume();
    };
    const onVisibility = (event: Event) => {
      visible = !(event as Event & { skipped?: boolean }).skipped;
      if (visible) resume();
      else pause();
    };
    container.addEventListener("contentvisibilityautostatechange", onVisibility);
    let observer: IntersectionObserver | undefined;
    if (!("contentVisibility" in document.documentElement.style)) {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) resume();
        else pause();
      }, { rootMargin: "200px" });
      observer.observe(container);
    }
    document.addEventListener("visibilitychange", resume);
    onCleanup(() => {
      container.removeEventListener("contentvisibilityautostatechange", onVisibility);
      document.removeEventListener("visibilitychange", resume);
      observer?.disconnect();
      worker?.stop();
      renderer?.dispose();
      initialized = false;
    });
  });

  let drag: { id: string | null; x: number; y: number; moved: boolean } | null = null;
  const select = (id: string | null) => {
    if (id && props.scene.nodes.find((node) => node.id === id)?.kind === "cluster") {
      props.onToggleCluster?.(id);
    } else {
      props.onSelectNode?.(id);
    }
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const hit = renderer?.hitTest(event.clientX, event.clientY);
    drag = { id: hit?.id ?? null, x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
    if (hit) {
      const point = renderer!.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      worker?.drag(hit.id, point.x, point.y, true);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!renderer) return;
    if (!drag) {
      setHovered(renderer.hitTest(event.clientX, event.clientY)?.id ?? null);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.id) {
      const rect = canvas.getBoundingClientRect();
      const point = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      worker?.drag(drag.id, point.x, point.y, true);
    } else {
      renderer.panBy(dx, dy);
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag && !drag.moved) select(drag.id);
    if (drag?.id) worker?.resume();
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const focusedNode = () => props.scene.nodes[focusIndex()];
  const pinFocused = (id: string, pinned: boolean) => {
    const position = positions.find((entry) => entry.id === id);
    if (position) worker?.drag(id, position.x, position.y, pinned);
  };

  return (
    <div class="graph-canvas-wrap" ref={container}>
      <canvas
        class="graph-canvas"
        ref={canvas}
        tabindex="0"
        role="application"
        aria-label="Визуальный граф страниц. Стрелки перемещают камеру, Tab выбирает узлы, Enter подсвечивает"
        aria-activedescendant="graph-active-node"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onContextMenu={(event) => {
          event.preventDefault();
          const node = renderer?.hitTest(event.clientX, event.clientY);
          if (node) {
            setMenu({
              node,
              x: event.clientX,
              y: event.clientY,
              pinned: positions.find((entry) => entry.id === node.id)?.pinned ?? false,
            });
          }
        }}
        onDblClick={(event) => {
          const node = renderer?.hitTest(event.clientX, event.clientY);
          if (node && node.kind !== "cluster" && node.kind !== "asset") props.onOpenPage(node.title);
        }}
        onWheel={(event) => {
          event.preventDefault();
          const rect = canvas.getBoundingClientRect();
          renderer?.zoomBy(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.ctrlKey) {
            const delta = event.shiftKey ? -1 : 1;
            setFocusIndex((index) => nextGraphFocusIndex(index, delta, props.scene.nodes.length));
            const node = focusedNode();
            if (node) renderer?.centerOn(node.id);
          } else if (event.key === "Enter") {
            const node = focusedNode();
            if (node) select(node.id);
          } else if (event.key === "Escape") {
            props.onSelectNode?.(null);
            setMenu(null);
          } else if (event.key === "+" || event.key === "=") renderer?.zoomBy(1.15);
          else if (event.key === "-") renderer?.zoomBy(0.87);
          else if (event.key.startsWith("Arrow")) renderer?.panBy(
            event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0,
            event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0,
          );
          else return;
          event.preventDefault();
        }}
      />
      <canvas class="graph-labels" ref={labels} aria-hidden="true" />
      <span id="graph-active-node" class="visually-hidden">
        {focusedNode() ? `${focusedNode()!.title}, ${focusedNode()!.kind}, связей: ${focusedNode()!.degree}` : "Нет узлов"}
      </span>
      <div class="graph-toolbar" aria-label="Управление масштабом">
        <button type="button" title="Приблизить" aria-label="Приблизить" onClick={() => renderer?.zoomBy(1.2)}>+</button>
        <button type="button" title="Отдалить" aria-label="Отдалить" onClick={() => renderer?.zoomBy(0.83)}>−</button>
        <button type="button" title="Вписать граф" onClick={() => renderer?.fit()}>Вписать</button>
      </div>
      <Show when={menu()}>
        {(current) => (
          <GraphMenu
            menu={current()}
            onClose={() => setMenu(null)}
            onOpenPage={props.onOpenPage}
            onOpenAsset={(path) => void assetOpen(path)}
            onRevealAsset={(path) => void assetReveal(path)}
            onCopyLink={(name) => void navigator.clipboard.writeText(`[[${name}]]`)}
            onPin={(pinned) => pinFocused(current().node.id, pinned)}
            onHide={(id) => props.onHideNode?.(id)}
            onToggleCluster={(id) => props.onToggleCluster?.(id)}
          />
        )}
      </Show>
      <div class="graph-error" hidden={!container?.dataset.error}>{container?.dataset.error}</div>
    </div>
  );
}
