import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { GraphSnapshotDto, GraphViewSettings } from "~/lib/api";
import { visualGraphLocal, visualGraphSnapshot } from "~/lib/api";
import { filterGraph } from "~/lib/graph/model";
import { LatestSnapshotLoader } from "~/lib/graph/live";
import { createLayoutSaver } from "~/lib/graph/layoutSaver";
import { loadCamera, saveCamera } from "~/lib/graph/persistence";
import { GraphCanvas } from "./GraphCanvas";

const JOURNAL = /^\d{4}_\d{2}_\d{2}$/;

export function LocalGraph(props: {
  page: string;
  refreshKey: number;
  settings: GraphViewSettings;
  onSettingsChange: (settings: GraphViewSettings) => void;
  onOpenPage: (name: string) => void;
  onOpenGlobal: (id: string) => void;
}) {
  const [scene, setScene] = createSignal<GraphSnapshotDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const root = () => `${JOURNAL.test(props.page) ? "journal" : "page"}:${props.page}`;

  const loader = new LatestSnapshotLoader(async () => {
    const full = await visualGraphSnapshot();
    const filtered = filterGraph(full, props.settings);
    const visible = new Set(filtered.nodes.map((node) => node.id));
    visible.add(root());
    return visualGraphLocal(root(), props.settings.localDepth, [...visible]);
  }, (result) => {
    setError(null);
    setScene(result);
  });
  let saver = createLayoutSaver(`local:${root()}`);
  let previousRoot = root();
  createEffect(() => {
    const currentRoot = root();
    void props.refreshKey;
    void props.settings.localDepth;
    if (currentRoot !== previousRoot) {
      previousRoot = currentRoot;
      loader.invalidate();
      setScene(null);
      saver?.dispose();
      saver = createLayoutSaver(`local:${currentRoot}`);
    }
    loader.request();
  });
  onCleanup(() => {
    loader.invalidate();
    saver?.dispose();
  });

  return (
    <section class="local-graph" aria-label={`Связи страницы ${props.page}`}>
      <header class="local-graph-header">
        <label>Глубина
          <select value={props.settings.localDepth} onChange={(event) => props.onSettingsChange({ ...props.settings, localDepth: Number(event.currentTarget.value) })}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <button type="button" onClick={() => props.onOpenGlobal(root())}>В глобальном</button>
      </header>
      <Show when={!error()} fallback={<div class="placeholder error">{error()}</div>}>
        <Show when={scene()} fallback={<div class="placeholder">Загрузка связей…</div>}>
          {(current) => (
            <GraphCanvas
              scene={current()}
              settings={props.settings}
              scope={`local:${root()}`}
              initialCamera={loadCamera(root(), "local")}
              onOpenPage={props.onOpenPage}
              onPositions={(entries) => saver.schedule(entries)}
              onCameraChange={(camera) => saveCamera(root(), "local", camera)}
              onSelectNode={(id) => {
                if (!id) return;
                const node = current().nodes.find((candidate) => candidate.id === id);
                if (node) props.onOpenPage(node.title);
              }}
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
