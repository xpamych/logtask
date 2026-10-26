import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { GraphSnapshotDto, GraphViewSettings } from "~/lib/api";
import { visualGraphSnapshot } from "~/lib/api";
import { clusterGraph, filterGraph } from "~/lib/graph/model";
import { GraphCanvas } from "./GraphCanvas";

export function GraphView(props: {
  refreshKey: number;
  settings: GraphViewSettings;
  onSettingsChange: (settings: GraphViewSettings) => void;
  onOpenPage: (name: string) => void;
  initialSelectedId?: string;
}) {
  const [snapshot, setSnapshot] = createSignal<GraphSnapshotDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const filtered = createMemo(() => {
    const current = snapshot();
    return current ? filterGraph(current, props.settings) : null;
  });
  const scene = createMemo(() => {
    const current = filtered();
    return current ? clusterGraph(current, props.settings, expanded()) : null;
  });

  createEffect(() => {
    void props.refreshKey;
    let active = true;
    void visualGraphSnapshot()
      .then((result) => {
        if (active) setSnapshot(result);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  });

  return (
    <section class="graph-view" aria-label="Граф связей">
      <header class="graph-header">
        <div>
          <h1>Граф связей</h1>
          <span class="graph-stats">
            {scene() ? `${scene()!.nodes.length} узлов · ${scene()!.edges.length} связей` : "Загрузка…"}
          </span>
        </div>
        <button type="button" onClick={() => setExpanded(new Set())} hidden={expanded().size === 0}>
          Свернуть группы
        </button>
      </header>
      <Show when={!error()} fallback={<div class="placeholder error">{error()}</div>}>
        <Show when={scene()} fallback={<div class="placeholder">Построение графа…</div>}>
          {(current) => (
            <GraphCanvas
              scene={current()}
              settings={props.settings}
              scope="global"
              focusId={props.initialSelectedId}
              onOpenPage={props.onOpenPage}
            />
          )}
        </Show>
      </Show>
    </section>
  );
}
