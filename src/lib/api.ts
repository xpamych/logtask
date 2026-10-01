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
  clockRunning: boolean;
  clockTotal: string | null;
  deadline: string | null;
  scheduled: string | null;
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

export interface TaskDto {
  uuid: string;
  page: string;
  content: string;
  status: string | null;
  statusLabel: string | null;
  priority: string | null;
  urgency: string | null;
  importance: string | null;
  deadline: string | null;
  scheduled: string | null;
  tags: string[];
  done: boolean;
}

export interface TaskColumn {
  marker: string;
  label: string;
  tasks: TaskDto[];
}

export interface TaskFilter {
  open: boolean;
  status: string[];
  page: string | null;
  pagePrefix: string | null;
  excludePage: string | null;
  tags: string[];
  quadrant: string | null;
}

export interface SavedQuery {
  title: string;
  filter: TaskFilter;
  sort: string[];
  collapsed: boolean;
}

export async function kanban(): Promise<TaskColumn[]> {
  return invoke<TaskColumn[]>("kanban");
}

export async function tasksByFilter(filter: TaskFilter): Promise<TaskDto[]> {
  return invoke<TaskDto[]>("tasks_by_filter", { filter });
}

export async function queriesList(): Promise<SavedQuery[]> {
  return invoke<SavedQuery[]>("queries_list");
}

export async function queriesSave(queries: SavedQuery[]): Promise<void> {
  await invoke<void>("queries_save", { queries });
}

export async function importLogseqQueries(): Promise<number> {
  return invoke<number>("import_logseq_queries");
}

export async function taskSetStatus(uuid: string, marker: string): Promise<string> {
  return invoke<string>("task_set_status", { uuid, marker });
}

export interface MatrixQuadrant {
  key: string;
  label: string;
  urgency: string;
  importance: string;
  tasks: TaskDto[];
}

export async function matrix(): Promise<MatrixQuadrant[]> {
  return invoke<MatrixQuadrant[]>("matrix");
}

export async function taskSetQuadrant(
  uuid: string,
  urgency: string | null,
  importance: string | null,
): Promise<string> {
  return invoke<string>("task_set_quadrant", { uuid, urgency, importance });
}

export async function blockUpdateText(uuid: string, content: string): Promise<string> {
  return invoke<string>("block_update_text", { uuid, content });
}

export async function blockDelete(uuid: string): Promise<string> {
  return invoke<string>("block_delete", { uuid });
}

export async function blockCreate(
  page: string,
  content: string,
  marker: string | null,
): Promise<string> {
  return invoke<string>("block_create", { page, content, marker });
}

export async function clockStart(uuid: string): Promise<string> {
  return invoke<string>("clock_start", { uuid });
}

export async function clockStop(uuid: string): Promise<string> {
  return invoke<string>("clock_stop", { uuid });
}

export interface StatusConfig {
  marker: string;
  label: string;
  color: string;
  visible: boolean;
  shortcut: string | null;
}

export interface Settings {
  theme: string;
  fontScale: number;
  weekStart: number;
  kanbanLimit: number;
  sidebarWidth: number;
  taskpanelWidth: number;
  statuses: StatusConfig[];
}

export async function settingsGet(): Promise<Settings> {
  return invoke<Settings>("settings_get");
}

export async function settingsSave(settings: Settings): Promise<void> {
  await invoke<void>("settings_save", { settings });
}

export async function taskSetPriority(
  uuid: string,
  priority: string | null,
): Promise<string> {
  return invoke<string>("task_set_priority", { uuid, priority });
}

export async function blockSetProp(
  uuid: string,
  key: string,
  value: string | null,
): Promise<string> {
  return invoke<string>("block_set_prop", { uuid, key, value });
}

export interface RecentGraph {
  path: string;
  lastOpened: string;
}

export async function recentGraphs(): Promise<RecentGraph[]> {
  return invoke<RecentGraph[]>("recent_graphs");
}

export async function pickGraphDir(): Promise<string | null> {
  return invoke<string | null>("pick_graph_dir");
}

export async function search(query: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search", { query });
}
