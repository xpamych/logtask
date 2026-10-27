import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { GraphLayoutEntry, GraphViewSettings } from "~/lib/api";
import { assetOpen, assetReveal, visualGraphLayoutGet } from "~/lib/api";
import { createLayoutMigration, mergeLayout, startLayoutWorker } from "~/lib/graph/layout";
import type { SceneGraph } from "~/lib/graph/model";
import type { CameraState } from "~/lib/graph/persistence";
import { markLayoutVersion, needsLayoutMigration } from "~/lib/graph/persistence";
import { QualityController } from "~/lib/graph/performance";
import { nextGraphFocusIndex } from "~/lib/graph/selection";
import { GraphMenu } from "./GraphMenu";
import type { GraphMenuState } from "./GraphMenu";
import { WebGlRenderer } from "./WebGlRenderer";
import { hasPointerDragged, shouldClickPointer } from "./pointerInteraction";

export function GraphCanvas(props: {
  scene: SceneGraph;
  settings: GraphViewSettings;
  graphRoot: string;
  scope: string;
  focusId?: string;
  resetLayoutKey?: number;
  initialCamera?: CameraState | null;
  highlight?: Set<string>;
  onOpenPage: (name: string) => void;
  onOpenLocal?: (name: string) => void;
  onSelectNode?: (id: string | null) => void;
  onToggleCluster?: (id: string) => void;
  onHideNode?: (id: string) => void;
  onPositions?: (entries: GraphLayoutEntry[]) => void;
  onLayoutFlush: () => Promise<void>;
  onCameraChange?: (camera: { x: number; y: number; zoom: number }) => void;
  onQuality?: (level: number) => void;
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
  const quality = new QualityController();
  const migration = createLayoutMigration();
  let lastQuality = 0;
  const reportFrame = (milliseconds: number) => {
    const level = quality.sample(milliseconds);
    if (level !== lastQuality) {
      lastQuality = level;
      props.onQuality?.(level);
    }
  };

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
  });

  createEffect(() => {
    void props.scene.nodes.map((node) => node.id).join("|");
    void props.scene.edges.map((edge) => edge.id).join("|");
    if (initialized) update();
  });

  createEffect(() => {
    void props.settings.centerForce;
    void props.settings.repelForce;
    void props.settings.linkForce;
    void props.settings.linkDistance;
    void props.settings.alphaDecay;
    if (initialized) worker?.params(props.settings);
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
    const highlight = props.highlight ?? new Set();
    const currentHovered = hovered();
    renderer?.setHighlight(highlight, currentHovered);
  });

  onMount(() => {
    try {
      renderer = new WebGlRenderer(canvas, labels);
      renderer.setScene(props.scene, props.settings);
      renderer.onCameraChange = (camera) => props.onCameraChange?.(camera);
      renderer.onFrameTime = reportFrame;
      if (props.initialCamera) renderer.setCamera(props.initialCamera);
      if (props.focusId) renderer.centerOn(props.focusId);
      worker = startLayoutWorker({
        onPositions: (entries) => {
          positions = entries;
          renderer?.setPositions(entries);
          const fitMigration = migration.consumeFit();
          props.onPositions?.(entries);
          if (fitMigration) renderer?.fit();
          if (fitMigration && props.onPositions) {
            void migration.complete(
              props.onLayoutFlush,
              () => markLayoutVersion(props.graphRoot, props.scope),
            ).catch((error) => console.error("завершение миграции layout:", error));
          }
        },
        onSettled: () => props.onPositions?.(positions),
      });
      initialized = true;
      performance.mark("logtask:graph-interactive");
      void visualGraphLayoutGet(props.scope)
        .catch(() => [])
        .then((entries) => {
          const migrate = needsLayoutMigration(props.graphRoot, props.scope);
          saved = migrate ? entries.filter((entry) => entry.pinned) : entries;
          if (migrate) migration.begin();
          update();
          if (!migrate && entries.length === 0) renderer?.fit();
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
    const onContextLost = (event: Event) => {
      event.preventDefault();
      pause();
    };
    const onContextRestored = () => {
      const camera = renderer?.getCamera();
      renderer?.dispose();
      renderer = new WebGlRenderer(canvas, labels);
      renderer.setScene(props.scene, props.settings);
      renderer.setPositions(positions);
      if (camera) renderer.setCamera(camera);
      renderer.onCameraChange = (next) => props.onCameraChange?.(next);
      renderer.onFrameTime = reportFrame;
      resume();
    };
    const onDocumentVisibility = () => {
      if (document.hidden) pause();
      else resume();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onDocumentVisibility);
    onCleanup(() => {
      container.removeEventListener("contentvisibilityautostatechange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", onDocumentVisibility);
      observer?.disconnect();
      worker?.stop();
      renderer?.dispose();
      initialized = false;
    });
  });

  let drag: {
    id: string | null;
    startX: number;
    startY: number;
    x: number;
    y: number;
    worldX: number;
    worldY: number;
    pinned: boolean;
    moved: boolean;
  } | null = null;
  const select = (id: string | null) => {
    if (id && props.scene.nodes.find((node) => node.id === id)?.kind === "cluster") {
      props.onToggleCluster?.(id);
    } else {
      props.onSelectNode?.(id);
    }
  };
  const click = (id: string | null, modified: boolean) => {
    const node = id ? props.scene.nodes.find((candidate) => candidate.id === id) : null;
    if (node && modified) props.onSelectNode?.(node.id);
    else if (node?.kind === "cluster") props.onToggleCluster?.(node.id);
    else if (node && node.kind !== "asset") props.onOpenPage(node.title);
    else props.onSelectNode?.(id);
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  const pointerDistance = () => {
    const [first, second] = [...pointers.values()];
    return Math.hypot(first.x - second.x, first.y - second.y);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinchDistance = pointerDistance();
      if (drag?.id && drag.moved) worker?.drag(drag.id, drag.worldX, drag.worldY, drag.pinned);
      if (drag?.id && drag.moved) worker?.resume();
      drag = null;
      return;
    }
    const hit = renderer?.hitTest(event.clientX, event.clientY);
    const position = hit ? positions.find((entry) => entry.id === hit.id) : null;
    drag = {
      id: hit?.id ?? null,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      worldX: position?.x ?? 0,
      worldY: position?.y ?? 0,
      pinned: position?.pinned ?? false,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!renderer) return;
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const distance = pointerDistance();
      if (pinchDistance > 0 && distance > 0) renderer.zoomBy(distance / pinchDistance);
      pinchDistance = distance;
      return;
    }
    if (!drag) {
      setHovered(renderer.hitTest(event.clientX, event.clientY)?.id ?? null);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (hasPointerDragged(drag.startX, drag.startY, event.clientX, event.clientY)) drag.moved = true;
    if (drag.id && drag.moved) {
      const rect = canvas.getBoundingClientRect();
      const point = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      drag.worldX = point.x;
      drag.worldY = point.y;
      worker?.drag(drag.id, point.x, point.y, true);
    } else {
      renderer.panBy(dx, dy);
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  const onPointerUp = (event: PointerEvent, cancelled = false) => {
    pointers.delete(event.pointerId);
    pinchDistance = 0;
    if (drag && shouldClickPointer(drag.moved, cancelled)) click(drag.id, event.ctrlKey || event.metaKey);
    if (drag?.id && drag.moved) {
      worker?.drag(drag.id, drag.worldX, drag.worldY, drag.pinned);
      worker?.resume();
    }
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
        onPointerCancel={(event) => onPointerUp(event, true)}
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
            (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0) * (event.shiftKey ? 3 : 1),
            (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) * (event.shiftKey ? 3 : 1),
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
        <button type="button" title="Вернуться к выбранному" onClick={() => {
          const id = props.highlight?.values().next().value ?? focusedNode()?.id;
          if (id) renderer?.centerOn(id);
        }}>К выбранному</button>
      </div>
      <Show when={menu()}>
        {(current) => (
          <GraphMenu
            menu={current()}
            onClose={() => setMenu(null)}
            onOpenPage={props.onOpenPage}
            onOpenLocal={(name) => props.onOpenLocal?.(name)}
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
