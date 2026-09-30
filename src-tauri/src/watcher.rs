//! Наблюдатель за файлами графа: при изменениях .md снаружи (Syncthing,
//! ручное редактирование) перестраивает индекс и сообщает UI.
//!
//! Используем notify напрямую (а не debouncer-mini), чтобы фильтровать
//! события доступа (чтение файлов самой индексацией порождает inotify-шум
//! и петлю). События коалесцируются: переиндексация стартует только после
//! окна тишины.

use std::path::PathBuf;
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
    let root = root.unwrap_or_else(|| PathBuf::from(default_graph_path()));
    if !root.is_dir() {
        return Err(format!("граф не найден: {}", root.display()));
    }

    let app = Arc::new(app.clone());
    let (tx, rx) = mpsc::channel::<()>();

    // коалесцирующий поток: ждёт тишину QUIET_MS и переиндексирует один раз
    {
        let app = app.clone();
        std::thread::spawn(move || loop {
            if rx.recv().is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(QUIET_MS));
            // сбрасываем накопившийся дребезг
            while rx.try_recv().is_ok() {}
            reindex_and_emit(&app);
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
                let _ = tx_event.send(());
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

fn reindex_and_emit(app: &AppHandle) {
    let root: Option<PathBuf> = app.state::<AppState>().root.read().clone();
    let Some(root) = root else {
        return;
    };

    let mut graph = Graph::default();
    match graph.index_dir(&root) {
        Ok(stats) => {
            log::info!(
                "граф переиндексирован: {} журналов, {} страниц, {} задач",
                stats.journals,
                stats.pages,
                stats.tasks
            );
            let summary = graph_summary_from(&root, &stats);
            {
                let state = app.state::<AppState>();
                *state.graph.write() = Some(graph);
            }
            let _ = app.emit("graph-changed", summary);
        }
        Err(e) => {
            log::warn!("ошибка переиндексации: {e}");
        }
    }
}

fn graph_summary_from(root: &std::path::Path, stats: &IndexStats) -> crate::commands::GraphSummary {
    crate::commands::GraphSummary {
        pages: stats.pages,
        journals: stats.journals,
        blocks: stats.blocks,
        tasks: stats.tasks,
        backlinks: 0,
        root: Some(root.display().to_string()),
    }
}

// silence unused import warning when RecommendedWatcher alias differs
#[allow(unused_imports)]
use notify::Watcher as _WatcherTrait;
