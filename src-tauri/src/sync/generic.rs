//! Адаптер произвольного REST API по JSONPath-конфигу (PPDB и т.п.).

use super::config::SourceConfig;
use super::remote::{self, RemoteTask};
use super::{http, jsonpath, secrets};
use crate::core::model::Status;
use serde_json::Value;

/// Забирает задачи GET-запросом и маппит поля по конфигу.
pub async fn fetch(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    if !cfg.method.eq_ignore_ascii_case("GET") {
        return Err(format!(
            "generic: fetch поддерживает только GET, задано {:?}",
            cfg.method
        ));
    }
    let url = secrets::resolve(&cfg.url, graph_key)?;
    let headers = resolve_headers(cfg, graph_key)?;
    let json = http::get_json(client, &url, &headers).await?;
    if cfg.items_path.is_empty() {
        return Err("generic: не задан itemsPath".into());
    }
    let mut out = Vec::new();
    for item in jsonpath::select(&json, &cfg.items_path) {
        let field = |name: &str| {
            cfg.fields
                .get(name)
                .and_then(|p| jsonpath::select_string(item, p))
        };
        let Some(id) = field("id") else {
            continue; // задача без id бесполезна для синка
        };
        out.push(RemoteTask {
            id,
            title: field("title").unwrap_or_default(),
            status: field("status")
                .map(|s| remote::map_status(&s, &cfg.status_map))
                .unwrap_or(Status::Todo),
            priority: field("priority").and_then(|s| remote::map_priority(&s, &cfg.priority_map)),
            assignee: field("assignee"),
            author: field("author"),
            created: field("created"),
            url: field("url"),
            page: cfg.page.clone(),
        });
    }
    Ok(out)
}

/// Отправляет статус задачи на сервер по блоку `push` конфига.
/// Блока push нет — источник только на импорт, молча Ok.
pub async fn push_status(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let Some(push) = &cfg.push else {
        return Ok(());
    };
    let out_status = remote::map_status_out(status.to_marker(), &push.status_map_out);
    // {id} и {status} подставляются и в URL (сервер может ждать их в query)
    let url = secrets::resolve(
        &push
            .url
            .replace("{id}", id)
            .replace("{status}", &out_status),
        graph_key,
    )?;
    let body = substitute(&push.body_template, id, &out_status);
    let headers = resolve_headers(cfg, graph_key)?;
    http::send_json(client, &push.method, &url, &headers, &body).await
}

fn resolve_headers(cfg: &SourceConfig, graph_key: &str) -> Result<Vec<(String, String)>, String> {
    cfg.headers
        .iter()
        .map(|(k, v)| Ok((k.clone(), secrets::resolve(v, graph_key)?)))
        .collect()
}

/// Рекурсивно подставляет "{id}" и "{status}" в строковые значения JSON
fn substitute(v: &Value, id: &str, status: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace("{id}", id).replace("{status}", status)),
        Value::Array(a) => Value::Array(a.iter().map(|x| substitute(x, id, status)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), substitute(x, id, status)))
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::model::Priority;
    use crate::sync::config::PushConfig;
    use std::collections::HashMap;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_config(url: &str, secret_name: &str) -> SourceConfig {
        SourceConfig {
            id: "ppdb".into(),
            kind: "generic".into(),
            name: "PPDB".into(),
            page: "PPDB - TODO".into(),
            url: url.into(),
            method: "GET".into(),
            headers: [(
                "Authorization".into(),
                format!("Bearer ${{secret:{secret_name}}}"),
            )]
            .into_iter()
            .collect(),
            items_path: "$.tasks[*]".into(),
            fields: [
                ("id".into(), "$.id".into()),
                ("title".into(), "$.title".into()),
                ("status".into(), "$.state".into()),
                ("priority".into(), "$.priority".into()),
                ("assignee".into(), "$.assignee".into()),
                ("url".into(), "$.url".into()),
            ]
            .into_iter()
            .collect(),
            status_map: [
                ("new".into(), "TODO".into()),
                ("in_progress".into(), "DOING".into()),
                ("completed".into(), "DONE".into()),
            ]
            .into_iter()
            .collect(),
            priority_map: [("high".into(), "A".into()), ("normal".into(), "B".into())]
                .into_iter()
                .collect(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn fetch_maps_fields_and_secret_header() {
        std::env::set_var("LOGTASK_SECRET_TEST_TOK", "tok-1");
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/tasks"))
            .and(header("Authorization", "Bearer tok-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tasks": [
                    {"id": 347, "title": "Список", "state": "in_progress", "priority": "high",
                     "assignee": "xpamych", "url": "https://x/347"},
                    {"id": "no-title-task", "state": "new"},
                    {"title": "без id — пропустить"}
                ]
            })))
            .mount(&server)
            .await;

        let cfg = test_config(&format!("{}/api/tasks", server.uri()), "test-tok");
        let tasks = fetch(&http::client().unwrap(), &cfg, "g").await.unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "347");
        assert_eq!(tasks[0].title, "Список");
        assert_eq!(tasks[0].status, Status::Doing);
        assert_eq!(tasks[0].priority, Some(Priority::A));
        assert_eq!(tasks[0].assignee.as_deref(), Some("xpamych"));
        assert_eq!(tasks[0].page, "PPDB - TODO");
        assert_eq!(tasks[1].status, Status::Todo);
        std::env::remove_var("LOGTASK_SECRET_TEST_TOK");
    }

    #[tokio::test]
    async fn fetch_http_error_is_reported() {
        std::env::set_var("LOGTASK_SECRET_TEST_TOK_ERR", "tok-err");
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&server)
            .await;
        let cfg = test_config(&server.uri(), "test-tok-err");
        let err = fetch(&http::client().unwrap(), &cfg, "g")
            .await
            .unwrap_err();
        assert!(err.contains("401"), "ожидался код ошибки: {err}");
        std::env::remove_var("LOGTASK_SECRET_TEST_TOK_ERR");
    }

    #[tokio::test]
    async fn push_substitutes_id_and_status() {
        std::env::set_var("LOGTASK_SECRET_TEST_TOK_PUSH", "tok-push");
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/tasks/ppdb-9/status"))
            .and(wiremock::matchers::query_param("status", "completed"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let mut cfg = test_config("http://unused", "test-tok-push");
        cfg.push = Some(PushConfig {
            url: format!("{}/api/tasks/{{id}}/status?status={{status}}", server.uri()),
            method: "POST".into(),
            body_template: serde_json::json!({"status": "{status}", "task": "{id}"}),
            status_map_out: HashMap::from([("DONE".into(), "completed".into())]),
        });
        push_status(&http::client().unwrap(), &cfg, "g", "ppdb-9", Status::Done)
            .await
            .unwrap();
        // wiremock проверит expect(1) при drop
        std::env::remove_var("LOGTASK_SECRET_TEST_TOK_PUSH");
    }

    #[tokio::test]
    async fn push_without_config_is_noop() {
        let cfg = test_config("http://unused", "unused");
        push_status(&http::client().unwrap(), &cfg, "g", "x", Status::Done)
            .await
            .unwrap();
    }

    #[test]
    fn substitute_replaces_recursively() {
        let v = serde_json::json!({"a": "{id}", "b": ["{status}", 1], "c": {"d": "x{id}y"}});
        let got = substitute(&v, "42", "open");
        assert_eq!(got["a"], "42");
        assert_eq!(got["b"][0], "open");
        assert_eq!(got["b"][1], 1);
        assert_eq!(got["c"]["d"], "x42y");
    }
}
