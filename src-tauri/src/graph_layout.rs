//! Производный кэш координат визуального графа.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLayoutEntry {
    pub id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutScope {
    pub scope: String,
    pub entries: Vec<GraphLayoutEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutFile<'a> {
    version: u8,
    scopes: &'a [LayoutScope],
}

fn valid_entry(value: &serde_json::Value) -> Option<GraphLayoutEntry> {
    let entry: GraphLayoutEntry = serde_json::from_value(value.clone()).ok()?;
    if entry.id.is_empty() || !entry.x.is_finite() || !entry.y.is_finite() {
        return None;
    }
    Some(entry)
}

pub fn load(root: &std::path::Path) -> Vec<LayoutScope> {
    let Ok(text) = std::fs::read_to_string(root.join(".logtask/graph-layout.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    if value.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Vec::new();
    }
    value
        .get("scopes")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|scope| {
            let name = scope.get("scope")?.as_str()?.to_string();
            let entries = scope
                .get("entries")?
                .as_array()?
                .iter()
                .filter_map(valid_entry)
                .collect();
            Some(LayoutScope {
                scope: name,
                entries,
            })
        })
        .collect()
}

pub fn save_scope(
    root: &std::path::Path,
    scope: &str,
    entries: Vec<GraphLayoutEntry>,
) -> std::io::Result<()> {
    if scope.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "пустая область layout",
        ));
    }
    let mut scopes = load(root);
    scopes.retain(|s| s.scope != scope);
    let entries = entries
        .into_iter()
        .filter(|entry| !entry.id.is_empty() && entry.x.is_finite() && entry.y.is_finite())
        .collect();
    scopes.push(LayoutScope {
        scope: scope.to_string(),
        entries,
    });
    scopes.sort_by(|a, b| a.scope.cmp(&b.scope));
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(&LayoutFile {
        version: 1,
        scopes: &scopes,
    })
    .map_err(|e| std::io::Error::other(format!("сериализация layout: {e}")))?;
    crate::core::fswrite::atomic_write(&dir.join("graph-layout.json"), &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("logtask_graph_layout_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(id: &str, x: f64) -> GraphLayoutEntry {
        GraphLayoutEntry {
            id: id.into(),
            x,
            y: x + 1.0,
            pinned: false,
        }
    }

    #[test]
    fn graph_layout_missing_and_unknown_version_are_empty() {
        let dir = temp_dir("missing");
        assert!(load(&dir).is_empty());
        std::fs::create_dir_all(dir.join(".logtask")).unwrap();
        std::fs::write(
            dir.join(".logtask/graph-layout.json"),
            r#"{"version":99,"scopes":[]}"#,
        )
        .unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn graph_layout_scopes_are_independent_and_non_finite_is_dropped() {
        let dir = temp_dir("scopes");
        save_scope(
            &dir,
            "global",
            vec![entry("page:A", 10.0), entry("bad", f64::NAN)],
        )
        .unwrap();
        save_scope(&dir, "local:page:A", vec![entry("page:A", 99.0)]).unwrap();
        let scopes = load(&dir);
        assert_eq!(scopes.len(), 2);
        let global = scopes.iter().find(|s| s.scope == "global").unwrap();
        assert_eq!(global.entries, vec![entry("page:A", 10.0)]);
        let local = scopes.iter().find(|s| s.scope == "local:page:A").unwrap();
        assert_eq!(local.entries, vec![entry("page:A", 99.0)]);
    }

    #[test]
    fn graph_layout_reads_valid_entries_from_mixed_file() {
        let dir = temp_dir("mixed");
        std::fs::create_dir_all(dir.join(".logtask")).unwrap();
        std::fs::write(
            dir.join(".logtask/graph-layout.json"),
            r#"{"version":1,"scopes":[{"scope":"global","entries":[{"id":"page:A","x":1,"y":2,"pinned":true},{"id":"bad","x":"NaN","y":2,"pinned":false}]}]}"#,
        ).unwrap();
        let scopes = load(&dir);
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].entries.len(), 1);
        assert_eq!(scopes[0].entries[0].id, "page:A");
        assert!(scopes[0].entries[0].pinned);
    }
}
