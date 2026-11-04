import type { SavedQuery } from "./api.ts";

export function upsertQuery(
  queries: SavedQuery[],
  query: SavedQuery,
  originalTitle: string | null,
): SavedQuery[] {
  const key = originalTitle ?? query.title;
  const index = queries.findIndex((item) => item.title === key);
  if (index === -1) return [...queries, query];
  return queries.map((item, i) => (i === index ? query : item));
}
