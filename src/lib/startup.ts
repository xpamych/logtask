export async function loadGraphBootstrap<S, P, T>(
  graphLoad: () => Promise<S>,
  pageList: () => Promise<P>,
  settingsGet: () => Promise<T>,
): Promise<{ summary: S; pages: P; settings: T }> {
  const summary = await graphLoad();
  const [pages, settings] = await Promise.all([pageList(), settingsGet()]);
  return { summary, pages, settings };
}
