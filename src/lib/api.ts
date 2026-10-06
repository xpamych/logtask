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
  extra: string[];
  /** полный редактируемый текст блока (как в Logseq): [#X] + контент +
   *  все строки-продолжения без базового отступа */
  source: string;
}

export interface PageDto {
  name: string;
  kind: string;
  blocks: BlockDto[];
  preamble: string[];
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

export async function graphClose(): Promise<void> {
  await invoke<void>("graph_close");
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

/** Переименовать страницу: файл + ссылки на неё во всём графе */
export async function pageRename(oldName: string, newName: string): Promise<void> {
  return invoke<void>("page_rename", { oldName, newName });
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
  props: [string, string][];
  /** исходник блока для инлайн-редактора в карточке */
  source: string;
  /** вложенные задачи (дочерние блоки-задачи, рекурсивно) */
  children: TaskDto[];
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

export interface MergeResult {
  page: string;
  uuid: string;
}

/** Склеить блок с вышестоящим (Backspace в начале блока) */
export async function blockMergeUp(uuid: string): Promise<MergeResult | null> {
  return invoke<MergeResult | null>("block_merge_up", { uuid });
}

/** Склеить блок с нижестоящим (Delete в конце блока) */
export async function blockMergeDown(uuid: string): Promise<MergeResult | null> {
  return invoke<MergeResult | null>("block_merge_down", { uuid });
}

/** Tab: сделать блок ребёнком предыдущего соседа */
export async function blockIndent(uuid: string): Promise<MergeResult | null> {
  return invoke<MergeResult | null>("block_indent", { uuid });
}

/** Shift+Tab: поднять блок на уровень родителя */
export async function blockOutdent(uuid: string): Promise<MergeResult | null> {
  return invoke<MergeResult | null>("block_outdent", { uuid });
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
  favorites: string[];
  systemTitlebar: boolean;
  homeView: string;
  statuses: StatusConfig[];
  integrations: IntegrationsConfig;
}

export async function settingsGet(): Promise<Settings> {
  return invoke<Settings>("settings_get");
}

export async function settingsSave(settings: Settings): Promise<void> {
  await invoke<void>("settings_save", { settings });
}

// ---------- Интеграции ----------

export interface PushConfig {
  url: string;
  method: string;
  bodyTemplate: unknown;
  statusMapOut: Record<string, string>;
}

export interface SourceConfig {
  id: string;
  type: string; // "generic" | "gitea" | "github" | "gitlab"
  name: string;
  enabled: boolean;
  page: string;
  pageTemplate: string;
  baseUrl: string;
  tokenRef: string | null;
  repos: string[];
  state: string | null;
  url: string;
  method: string;
  headers: Record<string, string>;
  itemsPath: string;
  fields: Record<string, string>;
  statusMap: Record<string, string>;
  priorityMap: Record<string, string>;
  push: PushConfig | null;
  syncIntervalMin: number;
}

export interface IntegrationsConfig {
  sources: SourceConfig[];
}

export interface SourceState {
  id: string;
  lastSync: string | null;
  lastError: string | null;
  secretSet: boolean | null;
}

export interface SyncReport {
  source: string;
  added: number;
  updated: number;
  pushed: number;
  removed: number;
  error?: string;
}

/** Новый источник с дефолтами (для кнопки «Добавить») */
export function newSourceConfig(kind: string): SourceConfig {
  return {
    id: "",
    type: kind,
    name: "",
    enabled: true,
    page: "",
    pageTemplate: "{repo} - TODO",
    baseUrl: "",
    tokenRef: null,
    repos: [],
    state: "open",
    url: "",
    method: "GET",
    headers: {},
    itemsPath: "",
    fields: {},
    statusMap: {},
    priorityMap: {},
    push: null,
    syncIntervalMin: 0,
  };
}

export async function integrationsStates(): Promise<SourceState[]> {
  return invoke<SourceState[]>("integrations_states");
}

export async function integrationsSetSecret(name: string, value: string): Promise<void> {
  await invoke<void>("integrations_set_secret", { name, value });
}

export async function integrationsTest(source: SourceConfig): Promise<number> {
  return invoke<number>("integrations_test", { source });
}

export async function integrationsSync(sourceId?: string): Promise<SyncReport[]> {
  return invoke<SyncReport[]>("integrations_sync", { sourceId: sourceId ?? null });
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

export async function recentRemove(path: string): Promise<void> {
  await invoke<void>("recent_remove", { path });
}

export async function pickGraphDir(title?: string): Promise<string | null> {
  return invoke<string | null>("pick_graph_dir", { title: title ?? null });
}

/** Создаёт пустую структуру графа (journals/ + pages/) в выбранной папке */
export async function graphCreate(path: string): Promise<void> {
  return invoke<void>("graph_create", { path });
}

/** true, если в папке нет ни journals/, ни pages/ — кандидат на новый граф */
export async function graphNeedsScaffold(path: string): Promise<boolean> {
  return invoke<boolean>("graph_needs_scaffold", { path });
}

export async function search(query: string): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search", { query });
}

/** Открывает внешнюю ссылку в системном браузере (IPC → opener-плагин в Rust) */
export async function openExternal(url: string): Promise<void> {
  return invoke<void>("open_external", { url });
}

/** Favicon домена ссылки как data-URL (грузится в Rust, кэшируется) */
export async function faviconDataUrl(url: string): Promise<string> {
  return invoke<string>("favicon_data_url", { url });
}

/** Заголовок веб-страницы по ссылке (тег title, грузится в Rust, кэшируется) */
export async function webTitle(url: string): Promise<string> {
  return invoke<string>("web_title", { url });
}

/** Картинка из графа как data-URL (для <img>) */
export async function assetDataUrl(path: string): Promise<string> {
  return invoke<string>("asset_data_url", { path });
}

/** Отладка: писать сообщение фронта в лог приложения */
export async function logFrontend(msg: string): Promise<void> {
  return invoke<void>("log_frontend", { msg });
}
