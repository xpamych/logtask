export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const cameraKey = (root: string, scope: string) => `logtask:graph-camera:${root}:${scope}`;
const expandedKey = (root: string, scope: string) => `logtask:graph-expanded:${root}:${scope}`;

export function loadCamera(root: string, scope: string, storage: StorageLike = localStorage): CameraState | null {
  try {
    const value = JSON.parse(storage.getItem(cameraKey(root, scope)) ?? "null") as Partial<CameraState> | null;
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.zoom)) return null;
    return { x: value.x!, y: value.y!, zoom: value.zoom! };
  } catch {
    return null;
  }
}

export function saveCamera(root: string, scope: string, camera: CameraState, storage: StorageLike = localStorage) {
  try {
    storage.setItem(cameraKey(root, scope), JSON.stringify(camera));
  } catch {
    // localStorage может быть недоступен в приватном режиме.
  }
}

export function loadExpanded(root: string, scope: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(expandedKey(root, scope)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveExpanded(root: string, scope: string, expanded: Set<string>) {
  try {
    localStorage.setItem(expandedKey(root, scope), JSON.stringify([...expanded]));
  } catch {
    // Состояние панели не влияет на данные графа.
  }
}
