//! Синхронизация задач с внешними источниками (docs/05-integrations.md).
//! Двусторонняя: fetch → merge → запись страниц; push статусов на сервер.

pub mod config;
pub mod forge;
pub mod generic;
pub mod http;
pub mod jsonpath;
pub mod merge;
pub mod remote;
pub mod secrets;
pub mod state;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::core::index::IndexStats;
use crate::core::model::{Graph, PageKind, Status};
use crate::state::AppState;
use config::SourceConfig;
use remote::RemoteTask;
use state::{SourceState, TaskState};

/// FNV-1a хэш в hex — для ключей keyring и отпечатков блоков
pub(crate) fn fnv1a_hex(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Источники, синхронизирующиеся прямо сейчас (гонка кнопка/таймер/старт)
fn running() -> &'static Mutex<Vec<String>> {
    static R: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub source: String,
    pub added: usize,
    pub updated: usize,
    pub pushed: usize,
    pub conflicts: usize,
    pub removed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Dispatch по типу источника
pub async fn fetch_all(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    match cfg.kind.as_str() {
        "generic" => generic::fetch(client, cfg, graph_key).await,
        "gitea" => forge::fetch_gitea(client, cfg, graph_key).await,
        "github" => forge::fetch_github(client, cfg, graph_key).await,
        "gitlab" => forge::fetch_gitlab(client, cfg, graph_key).await,
        other => Err(format!("неизвестный тип источника: {other:?}")),
    }
}

/// Dispatch push по типу источника
pub async fn push_status(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    match cfg.kind.as_str() {
        "generic" => generic::push_status(client, cfg, graph_key, id, status).await,
        "gitea" => forge::push_gitea(client, cfg, graph_key, id, status).await,
        "github" => forge::push_github(client, cfg, graph_key, id, status).await,
        "gitlab" => forge::push_gitlab(client, cfg, graph_key, id, status).await,
        other => Err(format!("неизвестный тип источника: {other:?}")),
    }
}

/// Push со свежесозданным клиентом — для write-back при смене статуса в UI
pub async fn push_status_standalone(
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let client = http::client()?;
    push_status(&client, cfg, graph_key, id, status).await
}

/// Синхронизирует один источник. Не паникует и не падает целиком:
/// ошибки — в SyncReport.error и в state-файл.
pub async fn sync_source(
    app: &tauri::AppHandle,
    state: &AppState,
    cfg: &SourceConfig,
) -> SyncReport {
    {
        let mut r = running().lock().unwrap();
        if r.contains(&cfg.id) {
            return SyncReport {
                source: cfg.id.clone(),
                error: Some("синхронизация уже выполняется".into()),
                ..Default::default()
            };
        }
        r.push(cfg.id.clone());
    }
    let _ = app.emit("sync-started", serde_json::json!({ "source": cfg.id }));
    let report = sync_inner(app, state, cfg).await;
    let _ = app.emit("sync-finished", &report);
    running().lock().unwrap().retain(|id| id != &cfg.id);
    report
}

async fn sync_inner(app: &tauri::AppHandle, state: &AppState, cfg: &SourceConfig) -> SyncReport {
    let mut report = SyncReport {
        source: cfg.id.clone(),
        ..Default::default()
    };
    let Some(root) = state.root.read().clone() else {
        report.error = Some("граф не загружен".into());
        return report;
    };
    let gkey = secrets::graph_key(&root);
    let client = match http::client() {
        Ok(c) => c,
        Err(e) => {
            report.error = Some(e);
            return report;
        }
    };

    // 1. fetch — без блокировки графа
    let remote = match fetch_all(&client, cfg, &gkey).await {
        Ok(t) => t,
        Err(e) => {
            state::record_error(&root, &cfg.id, Some(e.clone()));
            report.error = Some(e);
            return report;
        }
    };

    // 2. merge + запись страниц — под write-блокировкой, без сети
    let mut sync_state = state::load(&root);
    let mut pushes: Vec<(String, Status)> = vec![];
    {
        let mut guard = state.graph.write();
        let Some(graph) = guard.as_mut() else {
            report.error = Some("граф не загружен".into());
            return report;
        };
        let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
        apply_merge(
            graph,
            &root,
            cfg,
            &remote,
            src_state,
            &mut pushes,
            &mut report,
        );
    }

    // 3. push локальных изменений на сервер (успешные — обновят state)
    let mut pushed_ok: HashSet<String> = HashSet::new();
    for (rid, st) in &pushes {
        match push_status(&client, cfg, &gkey, rid, *st).await {
            Ok(()) => {
                pushed_ok.insert(rid.clone());
            }
            Err(e) => {
                state::record_error(&root, &cfg.id, Some(e.clone()));
                report.error = Some(e);
            }
        }
    }
    report.pushed = pushed_ok.len();

    // 4. обновляем отпечатки/статусы в state по итоговому графу
    {
        let guard = state.graph.read();
        if let Some(graph) = guard.as_ref() {
            let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
            refresh_task_states(graph, cfg, &remote, src_state, &pushed_ok);
        }
    }
    {
        let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
        src_state.last_sync = Some(chrono::Local::now().to_rfc3339());
        if report.error.is_none() {
            src_state.last_error = None;
        }
    }
    let _ = state::save(&root, &sync_state);

    // 5. переиндексация и событие для UI
    crate::commands::mark_self_write(state);
    crate::watcher::reindex_and_emit(app);
    report
}

/// Применяет merge к графу. Чистая часть синка — тестируется без сети.
fn apply_merge(
    graph: &mut Graph,
    root: &Path,
    cfg: &SourceConfig,
    remote: &[RemoteTask],
    src_state: &mut SourceState,
    pushes: &mut Vec<(String, Status)>,
    report: &mut SyncReport,
) {
    let mut by_page: HashMap<&str, Vec<&RemoteTask>> = HashMap::new();
    for t in remote {
        by_page.entry(t.page.as_str()).or_default().push(t);
    }

    // страницы для обхода: из remote + страницы, где у источника уже есть блоки
    // (иначе при пустом remote не сработает обработка исчезнувших задач)
    let mut pages: Vec<String> = by_page.keys().map(|s| s.to_string()).collect();
    for name in graph.pages.keys() {
        if by_page.contains_key(name.as_str()) {
            continue;
        }
        if !page_blocks_with_source(graph, name, &cfg.id).is_empty() {
            pages.push(name.clone());
        }
    }

    for page in &pages {
        let tasks: &[&RemoteTask] = by_page.get(page.as_str()).map(Vec::as_slice).unwrap_or(&[]);
        if let Err(e) = ensure_page(graph, root, page) {
            report.error = Some(format!("страница {page}: {e}"));
            continue;
        }
        let remote_ids: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        let existing = page_blocks_with_source(graph, page, &cfg.id);

        for &t in tasks {
            let found = existing
                .iter()
                .find(|(_, sid)| sid == &t.id)
                .map(|(u, _)| *u);
            let block = found.and_then(|u| graph.blocks.get(&u));
            let prev = src_state.tasks.get(&t.id);
            match merge::decide(Some(t), block, prev) {
                merge::Action::Add => {
                    add_task(graph, root, page, cfg, t);
                    report.added += 1;
                }
                merge::Action::Update => {
                    if let Some(uuid) = found {
                        update_task(graph, root, &uuid, cfg, t, false);
                        report.updated += 1;
                    }
                }
                merge::Action::Push => {
                    if let Some(status) = block.and_then(|b| b.status) {
                        pushes.push((t.id.clone(), status));
                    }
                }
                merge::Action::Conflict => {
                    if let Some(uuid) = found {
                        update_task(graph, root, &uuid, cfg, t, true);
                        report.conflicts += 1;
                    }
                }
                _ => {}
            }
        }

        // исчезнувшие с сервера
        for (uuid, sid) in existing {
            if remote_ids.contains(sid.as_str()) {
                continue;
            }
            let block = graph.blocks.get(&uuid);
            let prev = src_state.tasks.get(&sid);
            match merge::decide(None, block, prev) {
                merge::Action::Remove => {
                    let _ = graph.delete_block(&uuid, root);
                    src_state.tasks.remove(&sid);
                    report.removed += 1;
                }
                merge::Action::MarkMissing => {
                    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                    let _ = graph.mutate_block(&uuid, root, |b| {
                        b.set_prop("sync-missing", Some(&today));
                    });
                }
                _ => {}
            }
        }
    }
}

/// Создаёт файл страницы, если её ещё нет (пустой — наполнится задачами)
fn ensure_page(graph: &mut Graph, root: &Path, name: &str) -> std::io::Result<()> {
    if graph.pages.contains_key(name) {
        return Ok(());
    }
    let rel = PathBuf::from(format!("pages/{name}.md"));
    let abs = root.join(&rel);
    if !abs.exists() {
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::core::fswrite::atomic_write(&abs, "")?;
    }
    let mut stats = IndexStats {
        pages: 0,
        journals: 0,
        blocks: 0,
        tasks: 0,
        links: 0,
    };
    graph.index_file_content(name, PageKind::Page, "", None, &mut stats, Some(rel));
    Ok(())
}

/// (uuid, source-id) блоков страницы, импортированных из этого источника
fn page_blocks_with_source(graph: &Graph, page: &str, source: &str) -> Vec<(uuid::Uuid, String)> {
    let Some(p) = graph.pages.get(page) else {
        return vec![];
    };
    p.order
        .iter()
        .filter_map(|id| graph.blocks.get(id).map(|b| (*id, b)))
        .filter(|(_, b)| b.props.get("source").map(|s| s.as_str()) == Some(source))
        .filter_map(|(id, b)| b.props.get("source-id").map(|sid| (id, sid.clone())))
        .collect()
}

fn task_props(cfg: &SourceConfig, t: &RemoteTask) -> Vec<(String, String)> {
    let mut v = vec![
        ("source".to_string(), cfg.id.clone()),
        ("source-id".to_string(), t.id.clone()),
        ("synced-at".to_string(), chrono::Local::now().to_rfc3339()),
    ];
    if let Some(u) = &t.url {
        v.push(("url".to_string(), u.clone()));
    }
    if let Some(a) = &t.assignee {
        v.push(("assignee".to_string(), a.clone()));
    }
    if let Some(a) = &t.author {
        v.push(("author".to_string(), a.clone()));
    }
    if let Some(c) = &t.created {
        v.push(("created".to_string(), c.clone()));
    }
    v
}

fn add_task(graph: &mut Graph, root: &Path, page: &str, cfg: &SourceConfig, t: &RemoteTask) {
    let Ok(Some(uuid)) = graph.append_block(page, t.title.trim(), Some(t.status), root) else {
        log::warn!("sync: не удалось добавить блок на страницу {page}");
        return;
    };
    let priority = t.priority;
    let props = task_props(cfg, t);
    let _ = graph.mutate_block(&uuid, root, |b| {
        b.set_priority(priority);
        for (k, v) in &props {
            b.set_prop(k, Some(v));
        }
    });
}

/// Обновляет блок по данным сервера; conflict=true — ещё и метка sync-conflict
fn update_task(
    graph: &mut Graph,
    root: &Path,
    uuid: &uuid::Uuid,
    cfg: &SourceConfig,
    t: &RemoteTask,
    conflict: bool,
) {
    let priority = t.priority;
    let props = task_props(cfg, t);
    let title = t.title.trim().to_string();
    let status = t.status;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let _ = graph.mutate_block(uuid, root, |b| {
        b.set_status(status);
        // set_content перепарсивает [#X] и сбрасывает priority — поэтому раньше
        b.set_content(&title);
        b.set_priority(priority);
        for (k, v) in &props {
            b.set_prop(k, Some(v));
        }
        if conflict {
            b.set_prop("sync-conflict", Some(&today));
        } else {
            b.set_prop("sync-conflict", None);
        }
        b.set_prop("sync-missing", None);
    });
}

/// Пересчитывает TaskState по итоговому графу:
/// - remote_status — статус сервера (для успешно запушенных — запушенный);
/// - fingerprint — отпечаток текущего блока.
///
/// Неуспешные push не обновляются — следующий синк повторит попытку.
fn refresh_task_states(
    graph: &Graph,
    cfg: &SourceConfig,
    remote: &[RemoteTask],
    src_state: &mut SourceState,
    pushed_ok: &HashSet<String>,
) {
    for t in remote {
        let uuid = graph.blocks.iter().find_map(|(id, b)| {
            if b.props.get("source").map(|s| s.as_str()) == Some(cfg.id.as_str())
                && b.props.get("source-id").map(|s| s.as_str()) == Some(t.id.as_str())
            {
                Some(*id)
            } else {
                None
            }
        });
        let Some(uuid) = uuid else { continue };
        let Some(block) = graph.blocks.get(&uuid) else {
            continue;
        };
        let was_pushed = pushed_ok.contains(&t.id);
        // неуспешный push: оставляем старый state — синк повторит попытку
        let push_failed = block.status.map(|s| s.to_marker()) != Some(t.status.to_marker())
            && !was_pushed
            && src_state.tasks.contains_key(&t.id);
        if push_failed {
            continue;
        }
        src_state.tasks.insert(
            t.id.clone(),
            TaskState {
                remote_status: block
                    .status
                    .map(|s| s.to_marker().to_string())
                    .unwrap_or_else(|| t.status.to_marker().to_string()),
                fingerprint: merge::block_fingerprint(block),
            },
        );
    }
}

/// Синк всех включённых источников текущего графа (при старте и по кнопке)
pub async fn sync_all(app: &tauri::AppHandle) -> Vec<SyncReport> {
    let state = app.state::<AppState>();
    let Some(root) = state.root.read().clone() else {
        return vec![];
    };
    let settings = crate::settings::load(&root);
    let mut reports = vec![];
    for cfg in settings.integrations.sources.iter().filter(|s| s.enabled) {
        reports.push(sync_source(app, &state, cfg).await);
    }
    reports
}

/// Фон: начальный синк при открытии графа + тикер интервалов (раз в минуту
/// проверяет, какие источники «просрочились» по syncIntervalMin)
pub async fn startup_and_ticker(app: tauri::AppHandle) {
    sync_all(&app).await;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let state = app.state::<AppState>();
        let Some(root) = state.root.read().clone() else {
            continue;
        };
        let settings = crate::settings::load(&root);
        let st = state::load(&root);
        let now = chrono::Local::now();
        for cfg in settings
            .integrations
            .sources
            .iter()
            .filter(|s| s.enabled && s.sync_interval_min > 0)
        {
            let due = st
                .sources
                .get(&cfg.id)
                .and_then(|s| s.last_sync.as_ref())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|t| {
                    now.signed_duration_since(t.with_timezone(&chrono::Local))
                        .num_seconds()
                        >= (cfg.sync_interval_min * 60) as i64
                })
                .unwrap_or(true);
            if due {
                sync_source(&app, &state, cfg).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::model::Priority;

    #[test]
    fn fnv1a_stable() {
        assert_eq!(fnv1a_hex(b"logtask"), fnv1a_hex(b"logtask"));
        assert_ne!(fnv1a_hex(b"a"), fnv1a_hex(b"b"));
        assert_eq!(fnv1a_hex(b"").len(), 16);
    }

    // --- интеграция apply_merge с реальным графом во временной папке ---

    fn temp_graph(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logtask-sync-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::core::fswrite::scaffold_graph(&dir).unwrap();
        dir
    }

    fn load_graph(root: &Path) -> Graph {
        let mut g = Graph::default();
        g.index_dir(root).unwrap();
        g
    }

    fn test_cfg() -> SourceConfig {
        SourceConfig {
            id: "ppdb".into(),
            kind: "generic".into(),
            name: "PPDB".into(),
            page: "PPDB - TODO".into(),
            ..Default::default()
        }
    }

    fn task(id: &str, title: &str, status: Status) -> RemoteTask {
        RemoteTask {
            id: id.into(),
            title: title.into(),
            status,
            priority: Some(Priority::B),
            assignee: Some("xpamych".into()),
            author: None,
            created: Some("2026-07-15".into()),
            url: Some("https://x/1".into()),
            page: "PPDB - TODO".into(),
        }
    }

    fn run_merge(
        root: &Path,
        cfg: &SourceConfig,
        remote: &[RemoteTask],
        st: &mut SourceState,
    ) -> (SyncReport, Vec<(String, Status)>) {
        let mut graph = load_graph(root);
        let mut pushes = vec![];
        let mut report = SyncReport::default();
        apply_merge(&mut graph, root, cfg, remote, st, &mut pushes, &mut report);
        // обновляем state как sync_inner
        let pushed: HashSet<String> = pushes.iter().map(|(id, _)| id.clone()).collect();
        refresh_task_states(&graph, cfg, remote, st, &pushed);
        (report, pushes)
    }

    fn page_text(root: &Path, name: &str) -> String {
        std::fs::read_to_string(root.join("pages").join(format!("{name}.md"))).unwrap_or_default()
    }

    #[test]
    fn initial_import_creates_page_and_blocks() {
        let root = temp_graph("import");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        let remote = vec![task("ppdb-1", "Первая задача", Status::Todo)];

        let (report, pushes) = run_merge(&root, &cfg, &remote, &mut st);
        assert_eq!(report.added, 1);
        assert!(pushes.is_empty());

        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- TODO [#B] Первая задача"), "файл:\n{text}");
        assert!(text.contains("source:: ppdb"), "файл:\n{text}");
        assert!(text.contains("source-id:: ppdb-1"), "файл:\n{text}");
        assert!(text.contains("assignee:: xpamych"), "файл:\n{text}");
        assert!(st.tasks.contains_key("ppdb-1"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn second_sync_without_changes_is_noop() {
        let root = temp_graph("noop");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        let remote = vec![task("ppdb-1", "Первая задача", Status::Todo)];
        run_merge(&root, &cfg, &remote, &mut st);

        let (report, pushes) = run_merge(&root, &cfg, &remote, &mut st);
        assert_eq!(report.added, 0);
        assert_eq!(report.updated, 0);
        assert_eq!(report.removed, 0);
        assert!(pushes.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn remote_status_change_updates_block() {
        let root = temp_graph("update");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );

        let (report, _) = run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Done)],
            &mut st,
        );
        assert_eq!(report.updated, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- DONE [#B] Задача"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn local_status_change_is_pushed() {
        let root = temp_graph("push");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );

        // локально меняем статус через граф (как из UI)
        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Done, &root).unwrap();
        drop(graph);

        let (_, pushes) = run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );
        assert_eq!(pushes, vec![("ppdb-1".to_string(), Status::Done)]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn conflict_server_wins_and_marks_block() {
        let root = temp_graph("conflict");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );

        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Doing, &root).unwrap();
        drop(graph);

        let (report, _) = run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Done)],
            &mut st,
        );
        assert_eq!(report.conflicts, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- DONE [#B] Задача"), "файл:\n{text}");
        assert!(text.contains("sync-conflict::"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn vanished_untouched_task_is_removed() {
        let root = temp_graph("remove");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );

        let (report, _) = run_merge(&root, &cfg, &[], &mut st);
        assert_eq!(report.removed, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(!text.contains("ppdb-1"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn vanished_changed_task_is_marked_missing() {
        let root = temp_graph("missing");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(
            &root,
            &cfg,
            &[task("ppdb-1", "Задача", Status::Todo)],
            &mut st,
        );

        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Doing, &root).unwrap();
        drop(graph);

        let (report, _) = run_merge(&root, &cfg, &[], &mut st);
        assert_eq!(report.removed, 0);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("sync-missing::"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
