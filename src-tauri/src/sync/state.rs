//! Состояние синхронизации: .logtask/integrations-state.json.
//! По каждому source-id — серверный статус, отпечаток серверных данных и
//! отпечаток блока на момент последнего синка (база для merge) + время/ошибка
//! последнего синка.

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
    /// отпечаток серверных данных (remote::remote_fingerprint) на момент
    /// синка; пустой у состояний, записанных до появления поля — первый
    /// синк после обновления обновит такие блоки
    #[serde(default)]
    pub remote_hash: String,
}

fn state_path(root: &Path) -> std::path::PathBuf {
    root.join(".logtask").join("integrations-state.json")
}

pub fn load(root: &Path) -> Result<SyncState, String> {
    let path = state_path(root);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("{}: невалидный JSON: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SyncState::default()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

pub fn save(root: &Path, state: &SyncState) -> Result<(), String> {
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let text = serde_json::to_string_pretty(state).map_err(|e| format!("{e}"))?;
    crate::core::fswrite::atomic_write(&state_path(root), &text).map_err(|e| e.to_string())
}

pub fn state_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

/// Атомарно меняет один источник, сохраняя обновления остальных источников.
pub fn update<R>(
    root: &Path,
    source: &str,
    f: impl FnOnce(&mut SourceState) -> R,
) -> Result<R, String> {
    let _guard = state_lock()
        .lock()
        .map_err(|e| format!("блокировка state: {e}"))?;
    let mut st = load(root)?;
    let result = f(st.sources.entry(source.to_string()).or_default());
    save(root, &st)?;
    Ok(result)
}

/// Записывает ошибку источника, не трогая остальное состояние
pub fn record_error(root: &Path, source: &str, error: Option<String>) -> Result<(), String> {
    update(root, source, |state| state.last_error = error)
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
        let st = load(&root).unwrap();
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
                remote_hash: "h".into(),
            },
        );
        save(&root, &st).unwrap();

        let loaded = load(&root).unwrap();
        let src = loaded.sources.get("ppdb").unwrap();
        assert_eq!(src.last_sync.as_deref(), Some("2026-10-04T12:00:00+03:00"));
        assert!(src.last_error.is_none());
        assert_eq!(src.tasks["ppdb-1"].remote_status, "TODO");
        assert_eq!(src.tasks["ppdb-1"].fingerprint, "abc123");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn loads_legacy_state_without_remote_hash() {
        // состояния, записанные до появления remoteHash, читаются с пустым хэшом
        let root = temp_root("legacy");
        std::fs::create_dir_all(root.join(".logtask")).unwrap();
        std::fs::write(
            root.join(".logtask/integrations-state.json"),
            r#"{"sources":{"ppdb":{"tasks":{"1":{"remoteStatus":"TODO","fingerprint":"f"}}}}}"#,
        )
        .unwrap();
        let st = load(&root).unwrap();
        assert_eq!(st.sources["ppdb"].tasks["1"].remote_hash, "");
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
                remote_hash: "h".into(),
            },
        );
        save(&root, &st).unwrap();

        record_error(&root, "gitea", Some("HTTP 401".into())).unwrap();
        let loaded = load(&root).unwrap();
        let src = loaded.sources.get("gitea").unwrap();
        assert_eq!(src.last_error.as_deref(), Some("HTTP 401"));
        assert!(src.tasks.contains_key("o/r#1"));

        record_error(&root, "gitea", None).unwrap();
        assert!(load(&root).unwrap().sources["gitea"].last_error.is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn concurrent_sources_preserve_both_states() {
        let root = temp_root("concurrent");
        let mut handles = vec![];
        for source in ["gitea", "github"] {
            let root = root.clone();
            let source = source.to_string();
            handles.push(std::thread::spawn(move || {
                update(&root, &source, |state| {
                    state.last_sync = Some("2026-11-03T12:00:00+03:00".into());
                })
                .unwrap();
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }

        let loaded = load(&root).unwrap();
        assert!(loaded.sources.contains_key("gitea"));
        assert!(loaded.sources.contains_key("github"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn state_save_error_is_reported() {
        let root = temp_root("save-error");
        std::fs::write(root.join(".logtask"), "не каталог").unwrap();

        let result = update(&root, "gitea", |_| {});

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(root.join(".logtask")).unwrap(),
            "не каталог"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn invalid_sync_state_aborts_load() {
        let root = temp_root("invalid");
        std::fs::create_dir_all(root.join(".logtask")).unwrap();
        let path = root.join(".logtask/integrations-state.json");
        std::fs::write(&path, "{повреждено").unwrap();

        let error = load(&root).unwrap_err();
        let update_result = update(&root, "gitea", |state| {
            state.last_sync = Some("2026-11-03T12:00:00+03:00".into());
        });

        assert!(error.contains("integrations-state.json"), "{error}");
        assert!(update_result.is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "{повреждено");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
