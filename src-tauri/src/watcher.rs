//! Наблюдатель за файлами графа: при изменениях .md снаружи (Syncthing,
//! ручное редактирование) перестраивает индекс и сообщает UI.
//!
//! Используем notify напрямую (а не debouncer-mini), чтобы фильтровать
//! события доступа (чтение файлов самой индексацией порождает inotify-шум
//! и петлю). События коалесцируются: переиндексация стартует только после
//! окна тишины.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use notify::event::EventKind;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::default_graph_path;
use crate::core::index::IndexStats;
use crate::core::model::Graph;
use crate::state::AppState;

/// окно тишины после последнего события, прежде чем переиндексировать
const QUIET_MS: u64 = 350;

/// Запускает watcher для текущего загруженного графа (root из состояния).
/// Watcher сохраняется в состоянии приложения, чтобы наблюдение не
/// прерывалось преждевременным дропом.
pub fn spawn_for_current(app: &AppHandle) -> Result<(), String> {
    let root: Option<PathBuf> = app.state::<AppState>().root.read().clone();
    let root = match root.or_else(|| default_graph_path().map(PathBuf::from)) {
        Some(r) => r,
        None => return Err("граф не выбран — watcher не запущен".into()),
    };
    if !root.is_dir() {
        return Err(format!("граф не найден: {}", root.display()));
    }

    let app = Arc::new(app.clone());
    let (tx, rx) = mpsc::channel::<PathBuf>();

    // коалесцирующий поток: ждёт тишину QUIET_MS и переиндексирует один раз
    {
        let app = app.clone();
        let root = root.clone();
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                std::thread::sleep(Duration::from_millis(QUIET_MS));
                let mut changed = HashSet::from([first]);
                while let Ok(path) = rx.try_recv() {
                    changed.insert(path);
                }
                let needs_reindex = {
                    let state = app.state::<AppState>();
                    let graph = state.graph.read();
                    graph
                        .as_ref()
                        .map(|graph| paths_need_reindex(graph, &root, &changed))
                        .unwrap_or(true)
                };
                if needs_reindex {
                    reindex_and_emit(&app);
                }
            }
        });
    }

    let tx_event = tx.clone();
    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                // игнорируем события доступа — их порождает само чтение
                // файлов при индексации (inotify IN_ACCESS/IN_OPEN/IN_CLOSE)
                match event.kind {
                    EventKind::Access(_) | EventKind::Any | EventKind::Other => return,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {}
                }
                for path in event.paths {
                    if path.extension().is_some_and(|ext| ext == "md") {
                        let _ = tx_event.send(path);
                    }
                }
            }
        })
        .map_err(|e| format!("не удалось создать watcher: {e}"))?;

    for sub in ["journals", "pages"] {
        let dir = root.join(sub);
        if dir.is_dir() {
            watcher
                .watch(&dir, RecursiveMode::NonRecursive)
                .map_err(|e| format!("watch {dir:?}: {e}"))?;
        }
    }

    log::info!("watcher запущен на {root:?}");
    *app.state::<AppState>().watcher.write() = Some(watcher);
    Ok(())
}

pub fn paths_need_reindex(graph: &Graph, root: &Path, paths: &HashSet<PathBuf>) -> bool {
    for path in paths {
        if path.extension().map(|ext| ext != "md").unwrap_or(true) {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            return true;
        };
        let page = graph
            .pages
            .values()
            .find(|page| page.path.as_deref() == Some(relative));
        match (page, std::fs::read_to_string(path)) {
            (Some(page), Ok(text)) => {
                if crate::core::model::content_hash(&text) != page.content_hash {
                    return true;
                }
            }
            (None, Ok(_)) => return true,
            (Some(_), Err(e)) if e.kind() == std::io::ErrorKind::NotFound => return true,
            (None, Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {}
            (_, Err(_)) => return true,
        }
    }
    false
}

pub fn reindex_and_emit(app: &AppHandle) {
    reindex_with_context(app, None);
}

pub fn reindex_and_emit_if_current(app: &AppHandle, context: &crate::sync::GraphContext) -> bool {
    reindex_with_context(app, Some(context))
}

fn reindex_with_context(app: &AppHandle, context: Option<&crate::sync::GraphContext>) -> bool {
    let state = app.state::<AppState>();
    if context.is_some_and(|ctx| !crate::sync::context_is_current(&state, ctx)) {
        return false;
    }
    let root = match context {
        Some(ctx) => ctx.root.clone(),
        None => {
            let Some(root) = state.root.read().clone() else {
                return false;
            };
            root
        }
    };

    let mut graph = Graph::default();
    match graph.index_dir(&root) {
        Ok(mut stats) => {
            if context.is_some_and(|ctx| !crate::sync::context_is_current(&state, ctx)) {
                return false;
            }
            if crate::commands::cleanup_empty_journals(&root, &graph) {
                match graph.index_dir(&root) {
                    Ok(fresh) => stats = fresh,
                    Err(e) => {
                        log::warn!("ошибка переиндексации после очистки журналов: {e}");
                        return false;
                    }
                }
            }
            log::info!(
                "граф переиндексирован: {} журналов, {} страниц, {} задач",
                stats.journals,
                stats.pages,
                stats.tasks
            );
            let summary = graph_summary_from(&root, &stats, graph.backlinks.len());
            if context.is_some_and(|ctx| !crate::sync::context_is_current(&state, ctx)) {
                return false;
            }
            *state.graph.write() = Some(graph);
            let _ = app.emit("graph-changed", summary);
            true
        }
        Err(e) => {
            log::warn!("ошибка переиндексации: {e}");
            false
        }
    }
}

fn graph_summary_from(
    root: &std::path::Path,
    stats: &IndexStats,
    backlinks: usize,
) -> crate::commands::GraphSummary {
    crate::commands::GraphSummary {
        pages: stats.pages,
        journals: stats.journals,
        blocks: stats.blocks,
        tasks: stats.tasks,
        backlinks,
        root: Some(root.display().to_string()),
    }
}

// silence unused import warning when RecommendedWatcher alias differs
#[allow(unused_imports)]
use notify::Watcher as _WatcherTrait;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::model::Graph;
    use std::collections::HashSet;

    fn graph_root(tag: &str) -> (PathBuf, Graph) {
        let root =
            std::env::temp_dir().join(format!("logtask-watcher-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("pages")).unwrap();
        std::fs::write(root.join("pages/A.md"), "- исходный текст\n").unwrap();
        let mut graph = Graph::default();
        graph.index_dir(&root).unwrap();
        (root, graph)
    }

    fn paths(root: &Path, names: &[&str]) -> HashSet<PathBuf> {
        names.iter().map(|name| root.join(name)).collect()
    }

    #[test]
    fn external_change_during_self_write_is_not_suppressed() {
        let (root, graph) = graph_root("external");
        std::fs::write(root.join("pages/A.md"), "- внешняя правка\n").unwrap();

        assert!(paths_need_reindex(
            &graph,
            &root,
            &paths(&root, &["pages/A.md"])
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_mtime_different_hash_requires_reindex() {
        let (root, graph) = graph_root("same-mtime");
        let path = root.join("pages/A.md");
        std::fs::write(&path, "- другое содержимое\n").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(graph.pages["A"].mtime.unwrap())
            .unwrap();

        assert!(paths_need_reindex(
            &graph,
            &root,
            &paths(&root, &["pages/A.md"])
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn own_echo_is_skipped() {
        let (root, graph) = graph_root("own-echo");

        assert!(!paths_need_reindex(
            &graph,
            &root,
            &paths(&root, &["pages/A.md"])
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rename_paths_and_missing_files_require_reindex() {
        let (root, graph) = graph_root("rename");
        std::fs::rename(root.join("pages/A.md"), root.join("pages/B.md")).unwrap();

        assert!(paths_need_reindex(
            &graph,
            &root,
            &paths(&root, &["pages/A.md", "pages/B.md"])
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tmp_non_md_is_ignored() {
        let (root, graph) = graph_root("tmp");
        let tmp = root.join("pages/.A.md.123.logtask.tmp");
        std::fs::write(&tmp, "временное").unwrap();

        assert!(!paths_need_reindex(
            &graph,
            &root,
            &paths(&root, &["pages/.A.md.123.logtask.tmp"])
        ));
        std::fs::remove_dir_all(root).unwrap();
    }
}
