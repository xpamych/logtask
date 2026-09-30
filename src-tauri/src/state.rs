//! Глобальное состояние приложения: загруженный граф и файловый watcher

use std::path::PathBuf;

use crate::core::model::Graph;
use parking_lot::RwLock;

pub struct AppState {
    pub graph: RwLock<Option<Graph>>,
    pub root: RwLock<Option<PathBuf>>,
    /// watcher: пока жив — наблюдение активно
    pub watcher: RwLock<Option<notify::RecommendedWatcher>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            graph: RwLock::new(None),
            root: RwLock::new(None),
            watcher: RwLock::new(None),
        }
    }
}
