/** Видимые дни после обновления: сохраняем глубину уже загруженной ленты. */
export function visibleJournalsAfterRefresh(
  current: string[],
  available: string[],
  pageSize: number,
): string[] {
  const firstCurrent = current.length > 0 ? available.indexOf(current[0]) : -1;
  const newBefore = Math.max(0, firstCurrent);
  return available.slice(0, Math.max(pageSize, current.length + newBefore));
}

export function backlinksRefreshToken(name: string, refreshKey: number): string {
  return `${name}:${refreshKey}`;
}
