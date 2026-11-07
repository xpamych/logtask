//! Глобальное состояние приложения: загруженный граф и файловый watcher

use std::path::PathBuf;

use crate::core::model::Graph;
use parking_lot::{Mutex, RwLock};

pub struct AppState {
    pub graph: RwLock<Option<Graph>>,
    pub root: RwLock<Option<PathBuf>>,
    pub tray_available: std::sync::atomic::AtomicBool,
    pub tray_events: Mutex<crate::tray::TrayEvents>,
    /// поколение графа: увеличивается до смены/закрытия root и graph
    pub graph_epoch: std::sync::atomic::AtomicU64,
    /// watcher: пока жив — наблюдение активно
    pub watcher: RwLock<Option<notify::RecommendedWatcher>>,
    /// сериализация read-modify-write layout визуального графа
    pub layout_lock: Mutex<()>,
    /// фоновая задача синхронизации интеграций (abort при смене/закрытии графа)
    pub sync_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// проверка смены суток для создания нового журнала
    pub journal_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// кэш favicon (host → data-URL; пустая строка — «иконки нет»)
    pub favicons: RwLock<std::collections::HashMap<String, String>>,
    /// кэш заголовков веб-страниц (url → <title>)
    pub webtitles: RwLock<std::collections::HashMap<String, String>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            graph: RwLock::new(None),
            root: RwLock::new(None),
            tray_available: std::sync::atomic::AtomicBool::new(false),
            tray_events: Mutex::new(crate::tray::TrayEvents::default()),
            graph_epoch: std::sync::atomic::AtomicU64::new(0),
            watcher: RwLock::new(None),
            layout_lock: Mutex::new(()),
            sync_task: Mutex::new(None),
            journal_task: Mutex::new(None),
            favicons: RwLock::new(std::collections::HashMap::new()),
            webtitles: RwLock::new(std::collections::HashMap::new()),
        }
    }
}
