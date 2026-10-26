import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { GraphSnapshotDto, GraphViewSettings } from "~/lib/api";
import { visualGraphLocal, visualGraphSnapshot } from "~/lib/api";
import { filterGraph } from "~/lib/graph/model";
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

  createEffect(() => {
    void props.refreshKey;
    void props.settings.localDepth;
    let active = true;
    onCleanup(() => {
      active = false;
    });
    void (async () => {
      try {
        setError(null);
        const full = await visualGraphSnapshot();
        const filtered = filterGraph(full, props.settings);
        const visible = new Set(filtered.nodes.map((node) => node.id));
        visible.add(root());
        const local = await visualGraphLocal(root(), props.settings.localDepth, [...visible]);
        if (active) setScene(local);
      } catch (reason) {
        if (active) setError(String(reason));
      }
    })();
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
              onOpenPage={props.onOpenPage}
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
