//! Глобальное состояние приложения: загруженный граф и файловый watcher

use std::path::PathBuf;
use std::time::Instant;

use crate::core::model::Graph;
use parking_lot::{Mutex, RwLock};

pub struct AppState {
    pub graph: RwLock<Option<Graph>>,
    pub root: RwLock<Option<PathBuf>>,
    /// watcher: пока жив — наблюдение активно
    pub watcher: RwLock<Option<notify::RecommendedWatcher>>,
    /// момент последней записи, сделанной самим приложением
    pub last_self_write: Mutex<Option<Instant>>,
    /// фоновая задача синхронизации интеграций (abort при смене/закрытии графа)
    pub sync_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            graph: RwLock::new(None),
            root: RwLock::new(None),
            watcher: RwLock::new(None),
            last_self_write: Mutex::new(None),
            sync_task: Mutex::new(None),
        }
    }
}
