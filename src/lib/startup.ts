export function isGraphNotChosen(summary: unknown, graphClosed: boolean, error: string | null): boolean {
  if (summary) return false;
  return graphClosed || (error ?? "").includes("граф не выбран") || (error ?? "").includes("граф не найден");
}

export async function loadGraphBootstrap<S, P, T>(
  graphLoad: () => Promise<S>,
  pageList: () => Promise<P>,
  settingsGet: () => Promise<T>,
): Promise<{ summary: S; pages: P; settings: T }> {
  const summary = await graphLoad();
  const [pages, settings] = await Promise.all([pageList(), settingsGet()]);
  return { summary, pages, settings };
}
