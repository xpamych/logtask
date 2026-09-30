//! Недавние графы: хранятся в config-директории приложения.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentGraph {
    pub path: String,
    pub last_opened: String,
}

/// базовая config-директория: $XDG_CONFIG_HOME или $HOME/.config
fn config_base() -> Option<PathBuf> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return Some(PathBuf::from(xdg));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home).join(".config"));
        }
    }
    None
}

fn config_dir() -> Option<PathBuf> {
    Some(config_base()?.join("logtask"))
}

fn recent_path() -> Option<PathBuf> {
    Some(config_dir()?.join("recent.json"))
}

/// Список недавних графов (свежие первыми)
pub fn list() -> Vec<RecentGraph> {
    let Some(path) = recent_path() else {
        return Vec::new();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Добавляет/поднимает граф в начало списка
pub fn touch(root: &str) {
    let mut items = list();
    items.retain(|g| g.path != root);
    items.insert(
        0,
        RecentGraph {
            path: root.to_string(),
            last_opened: now_iso(),
        },
    );
    items.truncate(10);
    let _ = save(&items);
}

fn save(items: &[RecentGraph]) -> std::io::Result<()> {
    let Some(path) = recent_path() else {
        return Ok(());
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string_pretty(items)
        .map_err(|e| std::io::Error::other(format!("сериализация: {e}")))?;
    std::fs::write(&path, text)
}

fn now_iso() -> String {
    use crate::core::model::days_to_ymd;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = days_to_ymd(now / 86400);
    let secs = now % 86400;
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}
