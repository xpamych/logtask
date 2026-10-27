import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { GraphSnapshotDto, GraphViewSettings } from "~/lib/api";
import { visualGraphSnapshot } from "~/lib/api";
import { LatestSnapshotLoader } from "~/lib/graph/live";
import { createVisualLayoutSaver } from "~/lib/graph/visualLayoutSaver";
import { loadCamera, loadExpanded, saveCamera, saveExpanded } from "~/lib/graph/persistence";
import { qualityForSettings, sceneSettingsForQuality } from "~/lib/graph/performance";
import { clusterGraph, filterGraph, projectPathToClusters } from "~/lib/graph/model";
import { refreshGraphSelection, selectGraphNode, selectionHighlight } from "~/lib/graph/selection";
import type { GraphSelection } from "~/lib/graph/selection";
import { GraphCanvas } from "./GraphCanvas";

export function GraphView(props: {
  refreshKey: number;
  graphRoot: string;
  settings: GraphViewSettings;
  onSettingsChange: (settings: GraphViewSettings) => void;
  onOpenPage: (name: string) => void;
  onOpenLocal: (name: string) => void;
  initialSelectedId?: string;
  layoutResetKey?: number;
}) {
  const [snapshot, setSnapshot] = createSignal<GraphSnapshotDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal<Set<string>>(loadExpanded(props.graphRoot, "global"));
  const [selection, setSelection] = createSignal<GraphSelection | null>(null);
  const [quality, setQuality] = createSignal(0);
  const effectiveSettings = createMemo(() => qualityForSettings(props.settings, quality()));
  const sceneQuality = createMemo(() => quality() >= 4 ? 4 : 0);
  let saver = createVisualLayoutSaver(props.graphRoot, "global");
  const loader = new LatestSnapshotLoader(visualGraphSnapshot, (result) => {
    setError(null);
    setSnapshot(result);
  });
  const filtered = createMemo(() => {
    const current = snapshot();
    return current ? filterGraph(current, props.settings) : null;
  });
  const scene = createMemo(() => {
    const current = filtered();
    const settings = sceneSettingsForQuality(props.settings, sceneQuality());
    return current ? clusterGraph(current, settings, expanded()) : null;
  });
  const highlight = createMemo(() => {
    const current = filtered();
    const selected = selection();
    if (!current || !selected) return new Set<string>();
    const ids = selectionHighlight(selected, current);
    if (selected.path && scene()) return new Set(projectPathToClusters([...ids], scene()!));
    const clustered = new Set<string>();
    for (const node of scene()?.nodes ?? []) {
      if (ids.has(node.id) || node.clusterMembers?.some((id) => ids.has(id))) clustered.add(node.id);
    }
    return clustered;
  });
  const select = (id: string | null) => {
    if (!id) {
      setSelection(null);
      return;
    }
    const current = filtered();
    if (current) setSelection((selected) => selectGraphNode(selected, id, current));
  };
  let appliedFocus = "";
  createEffect(() => {
    const id = props.initialSelectedId;
    if (!id || appliedFocus === id || !filtered()?.nodes.some((node) => node.id === id)) return;
    appliedFocus = id;
    setSelection({ first: id, second: null, path: null, message: null });
  });

  createEffect(() => {
    const current = filtered();
    const selected = selection();
    if (!current || !selected) return;
    const refreshed = refreshGraphSelection(selected, current);
    if (JSON.stringify(refreshed) !== JSON.stringify(selected)) setSelection(refreshed);
  });

  const toggleCluster = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(props.graphRoot, "global", next);
      return next;
    });
  };

  let previousRoot = props.graphRoot;
  createEffect(() => {
    const root = props.graphRoot;
    void props.refreshKey;
    if (root !== previousRoot) {
      previousRoot = root;
      loader.invalidate();
      saver.dispose();
      saver = createVisualLayoutSaver(root, "global");
      setSnapshot(null);
      setExpanded(loadExpanded(root, "global"));
    }
    loader.request();
  });
  onCleanup(() => {
    loader.invalidate();
    saver.dispose();
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
        <span class="graph-path-message" role="status">{selection()?.message}</span>
        <button type="button" onClick={() => setExpanded(new Set())} hidden={expanded().size === 0}>
          Свернуть группы
        </button>
      </header>
      <Show when={!error()} fallback={<div class="placeholder error">{error()}</div>}>
        <Show when={scene()} fallback={<div class="placeholder">Построение графа…</div>}>
          {(current) => (
            <GraphCanvas
              scene={current()}
              settings={effectiveSettings()}
              graphRoot={props.graphRoot}
              scope="global"
              focusId={props.initialSelectedId}
              resetLayoutKey={props.layoutResetKey}
              initialCamera={loadCamera(props.graphRoot, "global")}
              highlight={highlight()}
              onOpenPage={props.onOpenPage}
              onOpenLocal={props.onOpenLocal}
              onPositions={saver.schedule}
              onLayoutFlush={saver.flush}
              onCameraChange={(camera) => saveCamera(props.graphRoot, "global", camera)}
              onQuality={setQuality}
              onSelectNode={select}
              onToggleCluster={toggleCluster}
              onHideNode={(id) => props.onSettingsChange({
                ...props.settings,
                exclusions: [...props.settings.exclusions, id],
              })}
            />
          )}
        </Show>
      </Show>
    </section>
  );
}
