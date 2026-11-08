import type { InlineSegment } from "./text.ts";

export class LatestRequest {
  private epoch = 0;

  next(): number {
    return ++this.epoch;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }
}

export function uniqueBlockRefIds(segments: InlineSegment[]): string[] {
  const ids = new Set<string>();
  for (const segment of segments) {
    if (segment.type === "blockRef" && segment.target) ids.add(segment.target);
    for (const id of uniqueBlockRefIds(segment.children ?? [])) ids.add(id);
  }
  return [...ids];
}

export interface AutocompleteContext {
  kind: "page" | "block";
  query: string;
  start: number;
  end: number;
}

function inCode(text: string, position: number): boolean {
  const before = text.slice(0, position);
  if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`+/g)?.length ?? 0) % 2 === 1;
}

export function findAutocompleteContext(text: string, caret: number): AutocompleteContext | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const page = before.lastIndexOf("[[");
  const block = before.lastIndexOf("((");
  const start = Math.max(page, block);
  if (start === -1 || inCode(before, start)) return null;
  const kind = start === block ? "block" : "page";
  const close = kind === "block" ? "))" : "]]";
  const query = before.slice(start + 2);
  if (query.includes(close) || query.includes("\n")) return null;
  return { kind, query, start, end: before.length };
}

export function completeAutocomplete(
  text: string,
  context: AutocompleteContext,
  replacement: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, context.start) + replacement + text.slice(context.end),
    caret: context.start + replacement.length,
  };
}
