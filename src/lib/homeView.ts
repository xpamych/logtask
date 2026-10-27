export type HomeView = { kind: "journal" | "tasks" | "pages" | "graph" };

export function homeViewFromSetting(value: string): HomeView {
  if (value === "tasks" || value === "pages" || value === "graph") {
    return { kind: value };
  }
  return { kind: "journal" };
}
