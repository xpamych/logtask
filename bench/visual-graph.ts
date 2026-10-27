import { render } from "solid-js/web";
import { GraphView } from "~/components/graph/GraphView";
import { DEFAULT_GRAPH_VIEW_SETTINGS } from "~/lib/graph/defaults";

render(
  () => GraphView({
    refreshKey: 0,
    graphRoot: "synthetic",
    settings: DEFAULT_GRAPH_VIEW_SETTINGS,
    onSettingsChange: () => undefined,
    onOpenPage: () => undefined,
    onOpenLocal: () => undefined,
  }),
  document.getElementById("app")!,
);
