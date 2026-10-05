//! Состояние синхронизации: .logtask/integrations-state.json.
//! По каждому source-id — серверный статус и отпечаток блока на момент
//! последнего синка (база для merge) + время/ошибка последнего синка.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    #[serde(default)]
    pub sources: HashMap<String, SourceState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    #[serde(default)]
    pub last_sync: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    /// ключ — source-id задачи
    #[serde(default)]
    pub tasks: HashMap<String, TaskState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    /// маркер Logseq статуса задачи на сервере на момент синка
    pub remote_status: String,
    /// отпечаток блока (merge::block_fingerprint) на момент синка
    pub fingerprint: String,
}

fn state_path(root: &Path) -> std::path::PathBuf {
    root.join(".logtask").join("integrations-state.json")
}

pub fn load(root: &Path) -> SyncState {
    match std::fs::read_to_string(state_path(root)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => SyncState::default(),
    }
}

pub fn save(root: &Path, state: &SyncState) -> Result<(), String> {
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let text = serde_json::to_string_pretty(state).map_err(|e| format!("{e}"))?;
    crate::core::fswrite::atomic_write(&state_path(root), &text).map_err(|e| e.to_string())
}

/// Записывает ошибку источника, не трогая остальное состояние
pub fn record_error(root: &Path, source: &str, error: Option<String>) {
    let mut st = load(root);
    st.sources.entry(source.to_string()).or_default().last_error = error;
    let _ = save(root, &st);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("logtask-syncstate-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_gives_empty_state() {
        let root = temp_root("missing");
        let st = load(&root);
        assert!(st.sources.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn save_and_load_roundtrip() {
        let root = temp_root("roundtrip");
        let mut st = SyncState::default();
        let src = st.sources.entry("ppdb".into()).or_default();
        src.last_sync = Some("2026-10-04T12:00:00+03:00".into());
        src.tasks.insert(
            "ppdb-1".into(),
            TaskState {
                remote_status: "TODO".into(),
                fingerprint: "abc123".into(),
            },
        );
        save(&root, &st).unwrap();

        let loaded = load(&root);
        let src = loaded.sources.get("ppdb").unwrap();
        assert_eq!(src.last_sync.as_deref(), Some("2026-10-04T12:00:00+03:00"));
        assert!(src.last_error.is_none());
        assert_eq!(src.tasks["ppdb-1"].remote_status, "TODO");
        assert_eq!(src.tasks["ppdb-1"].fingerprint, "abc123");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn record_error_keeps_tasks() {
        let root = temp_root("error");
        let mut st = SyncState::default();
        st.sources.entry("gitea".into()).or_default().tasks.insert(
            "o/r#1".into(),
            TaskState {
                remote_status: "DONE".into(),
                fingerprint: "f".into(),
            },
        );
        save(&root, &st).unwrap();

        record_error(&root, "gitea", Some("HTTP 401".into()));
        let loaded = load(&root);
        let src = loaded.sources.get("gitea").unwrap();
        assert_eq!(src.last_error.as_deref(), Some("HTTP 401"));
        assert!(src.tasks.contains_key("o/r#1"));

        record_error(&root, "gitea", None);
        assert!(load(&root).sources["gitea"].last_error.is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
