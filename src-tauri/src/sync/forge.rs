//! Адаптеры git-форжей: Gitea/Forgejo, GitHub, GitLab (включая self-hosted).
//! Маппинг статусов: open → TODO, closed → DONE.
//! Приоритет — из labels: critical/high → A, normal/medium → B, low → C.

use super::config::SourceConfig;
use super::remote::RemoteTask;
use super::{http, secrets};
use crate::core::model::{Priority, Status};

/// Имя репозитория без владельца: "xpamych/logtask" → "logtask"
fn short_repo(repo: &str) -> &str {
    repo.rsplit('/').next().unwrap_or(repo)
}

fn page_name(cfg: &SourceConfig, repo: &str) -> String {
    let tpl = if cfg.page_template.is_empty() {
        "{repo} - TODO"
    } else {
        &cfg.page_template
    };
    tpl.replace("{repo}", short_repo(repo))
}

/// Раскрывает список `repos`: запись с "/" — конкретный репозиторий,
/// запись без "/" — владелец (user/org/group), для него подтягиваются
/// все неархивные репозитории.
fn split_repos(repos: &[String]) -> (Vec<String>, Vec<String>) {
    repos.iter().cloned().partition(|r| r.contains('/'))
}

/// Имена репозиториев из ответа API (поля full_name/path_with_namespace, archived)
fn repo_names(json: &serde_json::Value, name_key: &str) -> Vec<String> {
    json.as_array()
        .into_iter()
        .flatten()
        .filter(|r| !r.get("archived").and_then(|a| a.as_bool()).unwrap_or(false))
        .filter_map(|r| r.get(name_key).and_then(|n| n.as_str()).map(String::from))
        .collect()
}

fn token(cfg: &SourceConfig, graph_key: &str) -> Result<Option<String>, String> {
    cfg.token_ref
        .as_deref()
        .map(|t| secrets::get(graph_key, t))
        .transpose()
}

/// Приоритет из имён labels (таблица как у плагина TE)
pub(crate) fn priority_from_labels<'a>(names: impl Iterator<Item = &'a str>) -> Option<Priority> {
    for n in names {
        match n.to_lowercase().as_str() {
            "critical" | "high" => return Some(Priority::A),
            "normal" | "medium" => return Some(Priority::B),
            "low" => return Some(Priority::C),
            _ => {}
        }
    }
    None
}

fn issue_status(state: &str) -> Status {
    if state == "closed" {
        Status::Done
    } else {
        Status::Todo
    }
}

// ---------- Gitea / Forgejo ----------

/// Все неархивные репозитории владельца: сначала пробуем как org, потом как user
async fn list_gitea_owner_repos(
    client: &reqwest::Client,
    base: &str,
    owner: &str,
    headers: &[(String, String)],
) -> Result<Vec<String>, String> {
    let org = format!("{base}/api/v1/orgs/{owner}/repos?limit=50");
    let user = format!("{base}/api/v1/users/{owner}/repos?limit=50");
    let json = match http::get_json(client, &org, headers).await {
        Ok(j) => j,
        Err(org_err) => http::get_json(client, &user, headers)
            .await
            .map_err(|user_err| format!("gitea: репозитории {owner:?}: {org_err}; {user_err}"))?,
    };
    Ok(repo_names(&json, "full_name"))
}

pub async fn fetch_gitea(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    let base = cfg.base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("gitea: не задан baseUrl".into());
    }
    let tok = token(cfg, graph_key)?;
    let headers = tok
        .as_ref()
        .map(|t| vec![("Authorization".into(), format!("token {t}"))])
        .unwrap_or_default();
    let state = cfg.state.as_deref().unwrap_or("open");
    let (mut repos, owners) = split_repos(&cfg.repos);
    for owner in owners {
        repos.extend(list_gitea_owner_repos(client, base, &owner, &headers).await?);
    }
    let mut out = Vec::new();
    for repo in &repos {
        let url = format!("{base}/api/v1/repos/{repo}/issues?state={state}&limit=100&type=issues");
        let json = http::get_json(client, &url, &headers).await?;
        let page = page_name(cfg, repo);
        for item in json.as_array().into_iter().flatten() {
            let number = item.get("number").and_then(|n| n.as_i64()).unwrap_or(0);
            let labels = item
                .get("labels")
                .and_then(|l| l.as_array())
                .into_iter()
                .flatten()
                .filter_map(|l| l.get("name").and_then(|n| n.as_str()));
            out.push(RemoteTask {
                id: format!("{repo}#{number}"),
                title: item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: issue_status(item.get("state").and_then(|s| s.as_str()).unwrap_or("open")),
                priority: priority_from_labels(labels),
                assignee: item
                    .get("assignee")
                    .and_then(|a| a.get("login"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                author: item
                    .get("user")
                    .and_then(|a| a.get("login"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                created: item
                    .get("created_at")
                    .and_then(|c| c.as_str())
                    .map(|s| s.chars().take(10).collect()),
                url: item
                    .get("html_url")
                    .and_then(|u| u.as_str())
                    .map(String::from),
                page: page.clone(),
            });
        }
    }
    Ok(out)
}

pub async fn push_gitea(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let (repo, num) = id
        .rsplit_once('#')
        .ok_or_else(|| format!("gitea: невалидный id задачи: {id}"))?;
    let base = cfg.base_url.trim_end_matches('/');
    let url = format!("{base}/api/v1/repos/{repo}/issues/{num}");
    let tok = token(cfg, graph_key)?;
    let headers = tok
        .as_ref()
        .map(|t| vec![("Authorization".into(), format!("token {t}"))])
        .unwrap_or_default();
    let state = if status.is_done() { "closed" } else { "open" };
    http::send_json(
        client,
        "PATCH",
        &url,
        &headers,
        &serde_json::json!({"state": state}),
    )
    .await
}

// ---------- GitHub ----------

/// Все неархивные репозитории владельца: сначала как org, потом как user
async fn list_github_owner_repos(
    client: &reqwest::Client,
    base: &str,
    owner: &str,
    headers: &[(String, String)],
) -> Result<Vec<String>, String> {
    let org = format!("{base}/orgs/{owner}/repos?per_page=100");
    let user = format!("{base}/users/{owner}/repos?per_page=100");
    let json = match http::get_json(client, &org, headers).await {
        Ok(j) => j,
        Err(org_err) => http::get_json(client, &user, headers)
            .await
            .map_err(|user_err| format!("github: репозитории {owner:?}: {org_err}; {user_err}"))?,
    };
    Ok(repo_names(&json, "full_name"))
}

pub async fn fetch_github(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    let base = if cfg.base_url.is_empty() {
        "https://api.github.com"
    } else {
        cfg.base_url.trim_end_matches('/')
    };
    let tok = token(cfg, graph_key)?;
    let mut headers = vec![("Accept".into(), "application/vnd.github+json".into())];
    if let Some(t) = &tok {
        headers.push(("Authorization".into(), format!("Bearer {t}")));
    }
    let state = cfg.state.as_deref().unwrap_or("open");
    let (mut repos, owners) = split_repos(&cfg.repos);
    for owner in owners {
        repos.extend(list_github_owner_repos(client, base, &owner, &headers).await?);
    }
    let mut out = Vec::new();
    for repo in &repos {
        let url = format!("{base}/repos/{repo}/issues?state={state}&per_page=100");
        let json = http::get_json(client, &url, &headers).await?;
        let page = page_name(cfg, repo);
        for item in json.as_array().into_iter().flatten() {
            // GitHub отдаёт PR в этом же эндпоинте — пропускаем
            if item.get("pull_request").is_some() {
                continue;
            }
            let number = item.get("number").and_then(|n| n.as_i64()).unwrap_or(0);
            let labels = item
                .get("labels")
                .and_then(|l| l.as_array())
                .into_iter()
                .flatten()
                .filter_map(|l| l.get("name").and_then(|n| n.as_str()));
            out.push(RemoteTask {
                id: format!("{repo}#{number}"),
                title: item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: issue_status(item.get("state").and_then(|s| s.as_str()).unwrap_or("open")),
                priority: priority_from_labels(labels),
                assignee: item
                    .get("assignee")
                    .and_then(|a| a.get("login"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                author: item
                    .get("user")
                    .and_then(|a| a.get("login"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                created: item
                    .get("created_at")
                    .and_then(|c| c.as_str())
                    .map(|s| s.chars().take(10).collect()),
                url: item
                    .get("html_url")
                    .and_then(|u| u.as_str())
                    .map(String::from),
                page: page.clone(),
            });
        }
    }
    Ok(out)
}

pub async fn push_github(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let (repo, num) = id
        .rsplit_once('#')
        .ok_or_else(|| format!("github: невалидный id задачи: {id}"))?;
    let base = if cfg.base_url.is_empty() {
        "https://api.github.com"
    } else {
        cfg.base_url.trim_end_matches('/')
    };
    let url = format!("{base}/repos/{repo}/issues/{num}");
    let tok = token(cfg, graph_key)?;
    let mut headers = vec![("Accept".into(), "application/vnd.github+json".into())];
    if let Some(t) = &tok {
        headers.push(("Authorization".into(), format!("Bearer {t}")));
    }
    let state = if status.is_done() { "closed" } else { "open" };
    http::send_json(
        client,
        "PATCH",
        &url,
        &headers,
        &serde_json::json!({"state": state}),
    )
    .await
}

// ---------- GitLab ----------

/// Все неархивные проекты группы (владельца)
async fn list_gitlab_group_projects(
    client: &reqwest::Client,
    base: &str,
    group: &str,
    headers: &[(String, String)],
) -> Result<Vec<String>, String> {
    let enc = group.replace('/', "%2F");
    let url = format!("{base}/api/v4/groups/{enc}/projects?per_page=100");
    let json = http::get_json(client, &url, headers).await?;
    Ok(repo_names(&json, "path_with_namespace"))
}

pub async fn fetch_gitlab(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    let base = cfg.base_url.trim_end_matches('/');
    if base.is_empty() {
        return Err("gitlab: не задан baseUrl".into());
    }
    let tok = token(cfg, graph_key)?;
    let headers = tok
        .as_ref()
        .map(|t| vec![("PRIVATE-TOKEN".into(), t.clone())])
        .unwrap_or_default();
    let state = match cfg.state.as_deref().unwrap_or("open") {
        "closed" => "closed",
        "all" => "all",
        _ => "opened",
    };
    let (mut repos, owners) = split_repos(&cfg.repos);
    for owner in owners {
        repos.extend(list_gitlab_group_projects(client, base, &owner, &headers).await?);
    }
    let mut out = Vec::new();
    for project in &repos {
        let enc = project.replace('/', "%2F");
        let url = format!("{base}/api/v4/projects/{enc}/issues?state={state}&per_page=100");
        let json = http::get_json(client, &url, &headers).await?;
        let page = page_name(cfg, project);
        for item in json.as_array().into_iter().flatten() {
            let iid = item.get("iid").and_then(|n| n.as_i64()).unwrap_or(0);
            let labels = item
                .get("labels")
                .and_then(|l| l.as_array())
                .into_iter()
                .flatten()
                .filter_map(|l| l.as_str());
            out.push(RemoteTask {
                id: format!("{project}#{iid}"),
                title: item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: issue_status(
                    item.get("state")
                        .and_then(|s| s.as_str())
                        .unwrap_or("opened"),
                ),
                priority: priority_from_labels(labels),
                assignee: item
                    .get("assignee")
                    .and_then(|a| a.get("username"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                author: item
                    .get("author")
                    .and_then(|a| a.get("username"))
                    .and_then(|l| l.as_str())
                    .map(String::from),
                created: item
                    .get("created_at")
                    .and_then(|c| c.as_str())
                    .map(|s| s.chars().take(10).collect()),
                url: item
                    .get("web_url")
                    .and_then(|u| u.as_str())
                    .map(String::from),
                page: page.clone(),
            });
        }
    }
    Ok(out)
}

pub async fn push_gitlab(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let (project, iid) = id
        .rsplit_once('#')
        .ok_or_else(|| format!("gitlab: невалидный id задачи: {id}"))?;
    let base = cfg.base_url.trim_end_matches('/');
    let enc = project.replace('/', "%2F");
    let url = format!("{base}/api/v4/projects/{enc}/issues/{iid}");
    let tok = token(cfg, graph_key)?;
    let headers = tok
        .as_ref()
        .map(|t| vec![("PRIVATE-TOKEN".into(), t.clone())])
        .unwrap_or_default();
    let event = if status.is_done() { "close" } else { "reopen" };
    http::send_json(
        client,
        "PUT",
        &url,
        &headers,
        &serde_json::json!({"state_event": event}),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn gitea_config(base: &str) -> SourceConfig {
        SourceConfig {
            id: "alr".into(),
            kind: "gitea".into(),
            name: "ALR".into(),
            base_url: base.into(),
            token_ref: Some("gitea-tok".into()),
            repos: vec!["xpamych/logtask".into()],
            page_template: "Gitea - {repo} - TODO".into(),
            state: Some("all".into()),
            ..Default::default()
        }
    }

    #[test]
    fn priority_from_label_names() {
        assert_eq!(
            priority_from_labels(["High"].into_iter()),
            Some(Priority::A)
        );
        assert_eq!(
            priority_from_labels(["bug", "low"].into_iter()),
            Some(Priority::C)
        );
        assert_eq!(priority_from_labels(["bug"].into_iter()), None);
    }

    #[test]
    fn short_repo_and_page_name() {
        let cfg = gitea_config("http://x");
        assert_eq!(short_repo("xpamych/logtask"), "logtask");
        assert_eq!(page_name(&cfg, "xpamych/logtask"), "Gitea - logtask - TODO");
    }

    #[tokio::test]
    async fn gitea_fetch_maps_issues() {
        std::env::set_var("LOGTASK_SECRET_GITEA_TOK", "sek");
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/repos/xpamych/logtask/issues"))
            .and(query_param("state", "all"))
            .and(header("Authorization", "token sek"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"number": 5, "title": "Сломалось", "state": "open",
                 "labels": [{"name": "high"}],
                 "user": {"login": "xpamych"}, "assignee": {"login": "xpamych"},
                 "created_at": "2026-09-01T10:00:00Z", "html_url": "https://git/issues/5"},
                {"number": 6, "title": "Починено", "state": "closed", "labels": []}
            ])))
            .mount(&server)
            .await;
        let cfg = gitea_config(&server.uri());
        let tasks = fetch_gitea(&http::client().unwrap(), &cfg, "g")
            .await
            .unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].id, "xpamych/logtask#5");
        assert_eq!(tasks[0].status, Status::Todo);
        assert_eq!(tasks[0].priority, Some(Priority::A));
        assert_eq!(tasks[0].created.as_deref(), Some("2026-09-01"));
        assert_eq!(tasks[0].page, "Gitea - logtask - TODO");
        assert_eq!(tasks[1].status, Status::Done);
        std::env::remove_var("LOGTASK_SECRET_GITEA_TOK");
    }

    #[tokio::test]
    async fn gitea_push_closes_issue() {
        // своё имя секрета: env-override из gitea_fetch_maps_issues удаляется
        // в конце того теста, при параллельном прогоне — гонка
        std::env::set_var("LOGTASK_SECRET_GITEA_PUSH_TOK", "sek");
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/api/v1/repos/xpamych/logtask/issues/5"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let mut cfg = gitea_config(&server.uri());
        cfg.token_ref = Some("gitea-push-tok".into());
        push_gitea(
            &http::client().unwrap(),
            &cfg,
            "g",
            "xpamych/logtask#5",
            Status::Done,
        )
        .await
        .unwrap();
        std::env::remove_var("LOGTASK_SECRET_GITEA_PUSH_TOK");
    }

    #[tokio::test]
    async fn gitea_owner_expands_to_repos() {
        // своё имя секрета: env-override не должен пересекаться с другими тестами
        std::env::set_var("LOGTASK_SECRET_GITEA_OWN_TOK", "sek");
        let server = MockServer::start().await;
        // org-эндпоинт 404 → fallback на users; архивный репозиторий отбрасывается
        Mock::given(method("GET"))
            .and(path("/api/v1/orgs/plemya/repos"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/users/plemya/repos"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"full_name": "plemya/alpha", "archived": false},
                {"full_name": "plemya/old", "archived": true}
            ])))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/repos/plemya/alpha/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"number": 1, "title": "Задача", "state": "open", "labels": []}
            ])))
            .mount(&server)
            .await;
        let mut cfg = gitea_config(&server.uri());
        cfg.token_ref = Some("gitea-own-tok".into());
        cfg.repos = vec!["plemya".into()];
        cfg.page_template = String::new(); // дефолтный шаблон: "{repo} - TODO"
        let tasks = fetch_gitea(&http::client().unwrap(), &cfg, "g")
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "plemya/alpha#1");
        assert_eq!(tasks[0].page, "alpha - TODO");
        std::env::remove_var("LOGTASK_SECRET_GITEA_OWN_TOK");
    }

    #[tokio::test]
    async fn github_skips_pull_requests() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/o/r/issues"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"number": 1, "title": "Issue", "state": "open", "labels": []},
                {"number": 2, "title": "PR", "state": "open", "labels": [],
                 "pull_request": {"url": "…"}}
            ])))
            .mount(&server)
            .await;
        let cfg = SourceConfig {
            id: "gh".into(),
            kind: "github".into(),
            name: "GH".into(),
            base_url: server.uri(),
            repos: vec!["o/r".into()],
            page_template: "GitHub - {repo} - TODO".into(),
            ..Default::default()
        };
        let tasks = fetch_github(&http::client().unwrap(), &cfg, "g")
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "o/r#1");
    }

    #[tokio::test]
    async fn gitlab_fetch_uses_encoded_project_and_iid() {
        std::env::set_var("LOGTASK_SECRET_GL_TOK", "sek");
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v4/projects/gr%2Fpr/issues"))
            .and(header("PRIVATE-TOKEN", "sek"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                {"iid": 3, "title": "GL issue", "state": "opened", "labels": ["medium"]}
            ])))
            .mount(&server)
            .await;
        let cfg = SourceConfig {
            id: "gl".into(),
            kind: "gitlab".into(),
            name: "GL".into(),
            base_url: server.uri(),
            token_ref: Some("gl-tok".into()),
            repos: vec!["gr/pr".into()],
            page_template: "GitLab - {repo} - TODO".into(),
            ..Default::default()
        };
        let tasks = fetch_gitlab(&http::client().unwrap(), &cfg, "g")
            .await
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "gr/pr#3");
        assert_eq!(tasks[0].priority, Some(Priority::B));
        std::env::remove_var("LOGTASK_SECRET_GL_TOK");
    }
}
