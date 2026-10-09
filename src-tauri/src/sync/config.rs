//! Конфигурация источников синхронизации. Хранится в settings.json
//! внутри ключа `integrations` (поле Settings.integrations).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsConfig {
    #[serde(default)]
    pub sources: Vec<SourceConfig>,
}

/// Write-back для generic-источника: куда слать смену статуса
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushConfig {
    /// URL с плейсхолдером {id}; может содержать ${secret:…}
    pub url: String,
    #[serde(default = "default_post")]
    pub method: String,
    /// JSON-тело; строки "{id}" и "{status}" подставляются
    #[serde(default)]
    pub body_template: serde_json::Value,
    /// маркер Logseq → значение для сервера (например "DONE" → "completed")
    #[serde(default)]
    pub status_map_out: HashMap<String, String>,
}

fn default_post() -> String {
    "POST".to_string()
}

fn default_get() -> String {
    "GET".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfig {
    /// стабильный id (латиница), попадает в свойство блока source::
    pub id: String,
    /// "generic" | "gitea" | "github" | "gitlab"
    #[serde(rename = "type")]
    pub kind: String,
    /// отображаемое имя
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// страница для generic-источника, например "PPDB - TODO"
    #[serde(default)]
    pub page: String,
    /// шаблон страницы для форжей, например "Gitea - {repo} - TODO"
    #[serde(default)]
    pub page_template: String,

    // --- форжи ---
    #[serde(default)]
    pub base_url: String,
    /// имя секрета в keyring (без значения)
    #[serde(default)]
    pub token_ref: Option<String>,
    /// "owner/repo" (gitea/github) или "group/project" (gitlab)
    #[serde(default)]
    pub repos: Vec<String>,
    /// фильтр состояния issues: "open" | "closed" | "all"
    #[serde(default)]
    pub state: Option<String>,

    // --- generic ---
    #[serde(default)]
    pub url: String,
    #[serde(default = "default_get")]
    pub method: String,
    /// значения могут содержать ${secret:имя}
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// JSONPath до массива задач, например "$.tasks[*]"
    #[serde(default)]
    pub items_path: String,
    /// JSONPath до полей: id/title/status/priority/assignee/author/created/url/milestone
    #[serde(default)]
    pub fields: HashMap<String, String>,
    /// значение сервера → маркер Logseq ("new" → "TODO")
    #[serde(default)]
    pub status_map: HashMap<String, String>,
    /// значение сервера → буква приоритета ("high" → "A")
    #[serde(default)]
    pub priority_map: HashMap<String, String>,
    #[serde(default)]
    pub push: Option<PushConfig>,

    /// интервал фоновой синхронизации, минут; 0 — выключено
    #[serde(default)]
    pub sync_interval_min: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_generic_source() {
        let json = r#"{
            "id": "ppdb", "type": "generic", "name": "PPDB",
            "page": "PPDB - TODO",
            "url": "https://ppdb.example/api/tasks",
            "itemsPath": "$.tasks[*]",
            "fields": {"id": "$.id", "title": "$.title", "status": "$.state"},
            "statusMap": {"new": "TODO", "completed": "DONE"}
        }"#;
        let cfg: SourceConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.id, "ppdb");
        assert_eq!(cfg.kind, "generic");
        assert!(cfg.enabled);
        assert_eq!(cfg.method, "GET");
        assert_eq!(cfg.sync_interval_min, 0);
        assert!(cfg.push.is_none());
        assert_eq!(cfg.status_map.get("new").unwrap(), "TODO");
    }

    #[test]
    fn parses_gitea_source_with_push() {
        let json = r#"{
            "id": "alr", "type": "gitea", "name": "ALR Gitea",
            "baseUrl": "https://git.alr-pkg.ru",
            "tokenRef": "gitea-alr",
            "repos": ["xpamych/logtask"],
            "pageTemplate": "Gitea - {repo} - TODO",
            "state": "open",
            "syncIntervalMin": 15
        }"#;
        let cfg: SourceConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.token_ref.as_deref(), Some("gitea-alr"));
        assert_eq!(cfg.repos, vec!["xpamych/logtask".to_string()]);
        assert_eq!(cfg.sync_interval_min, 15);
    }

    #[test]
    fn roundtrip_keeps_camel_case() {
        let cfg = IntegrationsConfig {
            sources: vec![SourceConfig {
                id: "x".into(),
                kind: "generic".into(),
                name: "X".into(),
                page_template: "Gitea - {repo} - TODO".into(),
                ..Default::default()
            }],
        };
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"pageTemplate\""));
        assert!(text.contains("\"syncIntervalMin\""));
        assert!(text.contains("\"type\":\"generic\""));
        let back: IntegrationsConfig = serde_json::from_str(&text).unwrap();
        assert_eq!(back.sources[0].id, "x");
    }
}
