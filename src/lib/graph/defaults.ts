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
  arrows: true,
  nodeScale: 1,
  edgeScale: 1,
  labelThreshold: 0.35,
  centerForce: 0.08,
  repelForce: 120,
  linkForce: 0.6,
  linkDistance: 90,
  alphaDecay: 0.03,
  localDepth: 1,
  journalAggregation: "month",
  clusterThreshold: 20,
};
