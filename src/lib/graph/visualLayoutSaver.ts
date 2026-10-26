import { visualGraphLayoutSave } from "~/lib/api";
import { createLayoutSaver } from "./layoutSaver";

export function createVisualLayoutSaver(root: string, scope: string) {
  return createLayoutSaver(root, scope, visualGraphLayoutSave);
}
