import type { GraphViewSettings } from "~/lib/api";

export const DEFAULT_GRAPH_VIEW_SETTINGS: GraphViewSettings = {
  search: "",
  showJournals: false,
  showTags: false,
  showAssets: false,
  onlyExisting: true,
  hideOrphans: false,
  exclusions: [],
  groups: [],
  arrows: false,
  nodeScale: 1,
  edgeScale: 1,
  labelThreshold: 0.35,
  centerForce: 0.12,
  repelForce: 45,
  linkForce: 0.75,
  linkDistance: 35,
  alphaDecay: 0.025,
  localDepth: 1,
  journalAggregation: "month",
  clusterThreshold: 20,
};
