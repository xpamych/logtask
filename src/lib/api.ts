import { invoke } from "@tauri-apps/api/core";

export interface GraphSummary {
  pages: number;
  journals: number;
  blocks: number;
  tasks: number;
  backlinks: number;
  root: string | null;
}

export interface BlockDto {
  uuid: string;
  status: string | null;
  statusLabel: string | null;
  priority: string | null;
  content: string;
  indent: number;
  task: boolean;
  urgency: string | null;
  importance: string | null;
  links: string[];
}

export interface PageDto {
  name: string;
  kind: string;
  blocks: BlockDto[];
}

export interface SearchHit {
  kind: string;
  page: string;
  text: string;
}

export async function ping(): Promise<string> {
  return invoke<string>("ping");
}

export async function graphLoad(path?: string): Promise<GraphSummary> {
  return invoke<GraphSummary>("graph_load", { path: path ?? null });
}

export async function graphSummary(): Promise<GraphSummary> {
  return invoke<GraphSummary>("graph_summary");
}

export async function journalList(): Promise<string[]> {
  return invoke<string[]>("journal_list");
}

export async function journalPrev(before: string, n: number): Promise<string[]> {
  return invoke<string[]>("journal_prev", { before, n });
}

export async function pageGet(name: string): Promise<PageDto> {
  return invoke<PageDto>("page_get", { name });
}

export async function followLink(target: string): Promise<PageDto | null> {
  return invoke<PageDto | null>("follow_link", { target });
}

export async function backlinksGet(name: string): Promise<[string, string][]> {
  return invoke<[string, string][]>("backlinks_get", { name });
}

export async function pageList(): Promise<string[]> {
  return invoke<string[]>("page_list");
}

export async function search(query: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search", { query });
}
