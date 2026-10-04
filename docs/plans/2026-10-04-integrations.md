# Интеграции: синхронизация задач из внешних источников — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Раздел «Интеграции» в настройках Logtask: двусторонняя синхронизация задач из произвольных REST API (JSONPath-маппинг) и issues из Gitea/Forgejo, GitHub, GitLab — по спеке `docs/specs/2026-10-04-integrations-design.md`.

**Architecture:** Синк-движок в Rust: новый модуль `src-tauri/src/sync/` (config, secrets, jsonpath, remote, http, generic, forge, merge, state, оркестратор). Импорт пишет страницы `{Источник} - TODO` через существующие `Graph::append_block`/`mutate_block`/`delete_block` (mtime-защита + атомарная запись + переиндексация внутри). Состояние синка — `.logtask/integrations-state.json`. Токены — в системном keyring, в конфиге только имена `${secret:…}`.

**Tech Stack:** Rust (reqwest 0.13 rustls, tokio, keyring 3, wiremock для тестов), Tauri 2 IPC, SolidJS фронтенд.

**Отступления от спеки (зафиксированы здесь):**
1. JSONPath — собственная минимальная реализация подмножества (`$.a.b`, `$.a[0]`, `$.a[*]`, `$.a[*].b`) без новой зависимости. Спека («крейт jsonpath_lib или аналог, версия фиксируется в плане») делегирует этот выбор плану: свои ~60 строк покрывают конфиги, легко тестируются, не тянут неподдерживаемый крейт.
2. Отдельных IPC `integrations_list/save/delete` нет: источники живут в `Settings.integrations.sources` и редактируются через общий поток настроек (`settings_get`/`settings_save`), как статусы канбана. Это исключает гонку «draft модалки затирает источники». Вместо них — `integrations_states` (время/ошибка последнего синка из state-файла).
3. «Вкладка» в настройках реализуется секцией `.settings-section` — вкладок в `SettingsModal` нет, а в исходном запросе был именно «раздел».

---

## Структура файлов

**Создаются (Rust):**
- `src-tauri/src/sync/mod.rs` — оркестратор `sync_source`/`sync_all`/`startup_and_ticker`, dispatch `fetch_all`/`push_status`, `fnv1a_hex`, `SyncReport`, применение merge к графу
- `src-tauri/src/sync/config.rs` — `IntegrationsConfig`, `SourceConfig`, `PushConfig` (serde, camelCase)
- `src-tauri/src/sync/secrets.rs` — keyring-обёртка + `${secret:имя}` + env-override для тестов
- `src-tauri/src/sync/jsonpath.rs` — подмножество JSONPath
- `src-tauri/src/sync/remote.rs` — `RemoteTask`, маппинги статусов/приоритетов
- `src-tauri/src/sync/http.rs` — reqwest-клиент, `get_json`
- `src-tauri/src/sync/generic.rs` — адаптер произвольного API
- `src-tauri/src/sync/forge.rs` — адаптеры gitea/github/gitlab
- `src-tauri/src/sync/merge.rs` — чистая merge-логика (`decide`, `block_fingerprint`, `Action`)
- `src-tauri/src/sync/state.rs` — `.logtask/integrations-state.json`

**Изменяются (Rust):**
- `src-tauri/Cargo.toml` — зависимости
- `src-tauri/src/lib.rs` — `pub mod sync;` + новые команды в handler
- `src-tauri/src/settings.rs` — поле `integrations`
- `src-tauri/src/state.rs` — поле `sync_task`
- `src-tauri/src/commands.rs` — IPC интеграций + write-back хук в `task_set_status` + запуск фона в `graph_load`/`graph_close`

**Создаются (фронт):**
- `src/components/IntegrationSources.tsx` — секция «Интеграции» для настроек

**Изменяются (фронт):**
- `src/lib/api.ts` — типы + обёртки
- `src/components/SettingsModal.tsx` — секция интеграций
- `src/components/Sidebar.tsx` — кнопка синка
- `src/App.tsx` — обработчик синка, события `sync-*`, toast
- `public/styles/global.css` — стили секции, спиннер, бейдж, toast

**Документация:**
- `docs/05-integrations.md` — новый
- `docs/01-architecture.md`, `AGENTS.md` — дополнения

---

## Task 1: Зависимости, модуль sync, конфиг источников

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/sync/mod.rs`
- Create: `src-tauri/src/sync/config.rs`
- Modify: `src-tauri/src/settings.rs:28-61` (struct Settings), `:139-154` (Default)
- Modify: `src-tauri/src/lib.rs:1-7`

- [ ] **Step 1: Добавить зависимости**

```bash
cd src-tauri
cargo add reqwest@0.13 --no-default-features --features json,rustls-tls
cargo add tokio@1 --features time,macros,rt-multi-thread
cargo add keyring@3
cargo add --dev wiremock
cd ..
```

Проверка: `cargo build --workspace` завершается без ошибок.

- [ ] **Step 2: Создать `src-tauri/src/sync/mod.rs` (скелет)**

```rust
//! Синхронизация задач с внешними источниками (docs/05-integrations.md).
//! Двусторонняя: fetch → merge → запись страниц; push статусов на сервер.

pub mod config;
pub mod secrets;

/// FNV-1a хэш в hex — для ключей keyring и отпечатков блоков
pub(crate) fn fnv1a_hex(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn fnv1a_stable() {
        assert_eq!(super::fnv1a_hex(b"logtask"), super::fnv1a_hex(b"logtask"));
        assert_ne!(super::fnv1a_hex(b"a"), super::fnv1a_hex(b"b"));
        assert_eq!(super::fnv1a_hex(b"").len(), 16);
    }
}
```

- [ ] **Step 3: Создать `src-tauri/src/sync/config.rs`**

```rust
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
    /// JSONPath до полей: id/title/status/priority/assignee/author/created/url
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
```

- [ ] **Step 4: Подключить модуль и поле в настройках**

В `src-tauri/src/lib.rs` (строки 1-7) добавить `pub mod sync;`:

```rust
mod commands;
pub mod config_edn;
pub mod core;
mod recent;
mod settings;
mod state;
pub mod sync;
mod watcher;
```

В `src-tauri/src/settings.rs`:

в struct `Settings` после поля `statuses` добавить:

```rust
    /// источники синхронизации задач (раздел «Интеграции»)
    #[serde(default)]
    pub integrations: crate::sync::config::IntegrationsConfig,
```

в `impl Default for Settings` после `statuses: default_statuses(),` добавить:

```rust
            integrations: Default::default(),
```

- [ ] **Step 5: Прогнать тесты**

```bash
cargo test --workspace sync:: 2>&1 | tail -5
cargo test --workspace settings 2>&1 | tail -5
```

Expected: `sync::config` и `sync::tests` — PASS; settings-тесты — PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml Cargo.lock src-tauri/src/sync/ src-tauri/src/settings.rs src-tauri/src/lib.rs
git commit -m "Интеграции: зависимости и конфиг источников синхронизации"
```

---

## Task 2: Секреты в keyring (`sync/secrets.rs`)

**Files:**
- Create: `src-tauri/src/sync/secrets.rs`

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/secrets.rs`**

```rust
//! Секреты интеграций: системное хранилище ключей (keyring).
//! В конфиге лежат только имена: ${secret:имя}.
//! Для тестов и CI: переменная окружения LOGTASK_SECRET_<ИМЯ> имеет приоритет.

const SERVICE: &str = "logtask";

/// Стабильный ключ графа для пространства имён секретов
pub fn graph_key(root: &std::path::Path) -> String {
    super::fnv1a_hex(root.to_string_lossy().as_bytes())
}

fn account(graph_key: &str, name: &str) -> String {
    format!("{graph_key}/{name}")
}

fn env_name(name: &str) -> String {
    let upper: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("LOGTASK_SECRET_{upper}")
}

pub fn set(graph_key: &str, name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .set_password(value)
        .map_err(|e| format!("keyring set {name:?}: {e}"))
}

pub fn get(graph_key: &str, name: &str) -> Result<String, String> {
    // env-override: для тестов (без системного keyring) и CI
    if let Ok(v) = std::env::var(env_name(name)) {
        return Ok(v);
    }
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("секрет {name:?} не найден в хранилище: {e}"))
}

pub fn delete(graph_key: &str, name: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .delete_credential()
        .map_err(|e| format!("keyring delete {name:?}: {e}"))
}

pub fn is_set(graph_key: &str, name: &str) -> bool {
    get(graph_key, name).is_ok()
}

/// Подставляет ${secret:имя} в строку конфига
pub fn resolve(text: &str, graph_key: &str) -> Result<String, String> {
    const MARK: &str = "${secret:";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(MARK) {
        out.push_str(&rest[..start]);
        let after = &rest[start + MARK.len()..];
        let end = after.find('}').ok_or("незакрытый плейсхолдер ${secret:…}")?;
        let name = &after[..end];
        out.push_str(&get(graph_key, name)?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_key_stable_and_distinct() {
        let a = graph_key(std::path::Path::new("/tmp/graph-a"));
        assert_eq!(a, graph_key(std::path::Path::new("/tmp/graph-a")));
        assert_ne!(a, graph_key(std::path::Path::new("/tmp/graph-b")));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn env_override_wins() {
        std::env::set_var("LOGTASK_SECRET_TEST_OVERRIDE", "from-env");
        assert_eq!(get("any-graph", "test-override").unwrap(), "from-env");
        std::env::remove_var("LOGTASK_SECRET_TEST_OVERRIDE");
    }

    #[test]
    fn resolve_substitutes_placeholders() {
        std::env::set_var("LOGTASK_SECRET_TOK", "abc123");
        let got = resolve("Bearer ${secret:tok}", "g").unwrap();
        assert_eq!(got, "Bearer abc123");
        let got = resolve("${secret:tok}/x/${secret:tok}", "g").unwrap();
        assert_eq!(got, "abc123/x/abc123");
        std::env::remove_var("LOGTASK_SECRET_TOK");
    }

    #[test]
    fn resolve_passes_plain_text() {
        assert_eq!(resolve("no secrets here", "g").unwrap(), "no secrets here");
    }

    #[test]
    fn resolve_errors_on_unclosed() {
        assert!(resolve("bad ${secret:tok", "g").is_err());
    }

    #[test]
    fn resolve_errors_on_missing_secret() {
        assert!(resolve("${secret:definitely-missing-42}", "g").is_err());
    }
}
```

- [ ] **Step 2: Прогнать тесты**

```bash
cargo test --workspace sync::secrets 2>&1 | tail -8
```

Expected: 6 тестов PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/secrets.rs
git commit -m "Интеграции: хранение токенов в системном keyring"
```

---

## Task 3: JSONPath-подмножество (`sync/jsonpath.rs`)

**Files:**
- Create: `src-tauri/src/sync/jsonpath.rs`

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/jsonpath.rs`**

```rust
//! Минимальное подмножество JSONPath для конфигов интеграций:
//! `$.a.b`, `$.arr[0]`, `$.arr[*]`, `$.arr[*].b`. Без фильтров/рекурсии/скриптов.

use serde_json::Value;

/// Возвращает все значения по пути. Пустой вектор — путь ничего не нашёл.
pub fn select<'a>(value: &'a Value, path: &str) -> Vec<&'a Value> {
    let path = path.trim();
    let path = path.strip_prefix('$').unwrap_or(path);
    let mut current: Vec<&Value> = vec![value];
    for seg in path.split('.').filter(|s| !s.is_empty()) {
        // сегмент вида name, name[*] или name[3]
        let (name, idx) = match seg.find('[') {
            Some(i) => (&seg[..i], seg[i..].trim_matches(['[', ']'])),
            None => (seg, ""),
        };
        let mut next = Vec::new();
        for v in current {
            let target = if name.is_empty() { Some(v) } else { v.get(name) };
            if let Some(t) = target {
                match idx {
                    "" => next.push(t),
                    "*" => {
                        if let Some(arr) = t.as_array() {
                            next.extend(arr.iter());
                        }
                    }
                    n => {
                        if let Ok(i) = n.parse::<usize>() {
                            if let Some(el) = t.get(i) {
                                next.push(el);
                            }
                        }
                    }
                }
            }
        }
        current = next;
    }
    current
}

/// Первое значение по пути как строка (числа/булевы — в текстовом виде)
pub fn select_string(value: &Value, path: &str) -> Option<String> {
    select(value, path).into_iter().next().and_then(|v| match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({
            "tasks": [
                {"id": 1, "title": "Первая", "meta": {"state": "new"}},
                {"id": 2, "title": "Вторая", "meta": {"state": "done"}}
            ],
            "total": 2,
            "ok": true
        })
    }

    #[test]
    fn selects_nested_field() {
        assert_eq!(select_string(&doc(), "$.total").as_deref(), Some("2"));
        assert_eq!(select_string(&doc(), "$.ok").as_deref(), Some("true"));
    }

    #[test]
    fn selects_array_wildcard() {
        let items = select(&doc(), "$.tasks[*]");
        assert_eq!(items.len(), 2);
        let titles = select(&doc(), "$.tasks[*].title");
        assert_eq!(titles.len(), 2);
    }

    #[test]
    fn field_of_each_item() {
        let first = &select(&doc(), "$.tasks[*]")[0];
        assert_eq!(select_string(first, "$.meta.state").as_deref(), Some("new"));
        assert_eq!(select_string(first, "$.id").as_deref(), Some("1"));
    }

    #[test]
    fn selects_array_index() {
        assert_eq!(
            select_string(&doc(), "$.tasks[1].title").as_deref(),
            Some("Вторая")
        );
    }

    #[test]
    fn missing_path_is_empty() {
        assert!(select(&doc(), "$.nope.deeper").is_empty());
        assert_eq!(select_string(&doc(), "$.tasks[9].title"), None);
    }

    #[test]
    fn works_without_dollar() {
        assert_eq!(select_string(&doc(), "total").as_deref(), Some("2"));
    }
}
```

- [ ] **Step 2: Прогнать тесты**

```bash
cargo test --workspace sync::jsonpath 2>&1 | tail -8
```

Expected: 6 тестов PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/jsonpath.rs
git commit -m "Интеграции: минимальное подмножество JSONPath для маппинга полей"
```

---

## Task 4: RemoteTask и маппинги (`sync/remote.rs`)

**Files:**
- Create: `src-tauri/src/sync/remote.rs`

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/remote.rs`**

```rust
//! Унифицированная задача из внешнего источника + маппинги статусов/приоритетов.

use crate::core::model::{Priority, Status};
use std::collections::HashMap;

/// Задача, приведённая адаптером к каноничному виду
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteTask {
    /// уникальный id в источнике (например "ppdb-347" или "owner/repo#12")
    pub id: String,
    pub title: String,
    pub status: Status,
    pub priority: Option<Priority>,
    pub assignee: Option<String>,
    pub author: Option<String>,
    pub created: Option<String>,
    pub url: Option<String>,
    /// страница назначения в графе (для форжей зависит от репозитория)
    pub page: String,
}

/// Значение сервера → Status по таблице из конфига. Неизвестное → Todo.
pub fn map_status(value: &str, map: &HashMap<String, String>) -> Status {
    map.get(value)
        .and_then(|m| Status::from_marker(m))
        .unwrap_or(Status::Todo)
}

/// Значение сервера → Priority ("A"/"B"/"C" в таблице конфига)
pub fn map_priority(value: &str, map: &HashMap<String, String>) -> Option<Priority> {
    match map.get(value).map(|s| s.as_str()) {
        Some("A") => Some(Priority::A),
        Some("B") => Some(Priority::B),
        Some("C") => Some(Priority::C),
        _ => None,
    }
}

/// Маркер Logseq → значение для сервера (обратный маппинг для push).
/// Нет записи в таблице — отправляется сам маркер.
pub fn map_status_out(marker: &str, map: &HashMap<String, String>) -> String {
    map.get(marker).cloned().unwrap_or_else(|| marker.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status_map() -> HashMap<String, String> {
        [
            ("new".into(), "TODO".into()),
            ("in_progress".into(), "DOING".into()),
            ("completed".into(), "DONE".into()),
            ("rejected".into(), "CANCELED".into()),
        ]
        .into_iter()
        .collect()
    }

    #[test]
    fn maps_known_statuses() {
        let m = status_map();
        assert_eq!(map_status("new", &m), Status::Todo);
        assert_eq!(map_status("in_progress", &m), Status::Doing);
        assert_eq!(map_status("rejected", &m), Status::Canceled);
    }

    #[test]
    fn unknown_status_falls_back_to_todo() {
        assert_eq!(map_status("weird", &status_map()), Status::Todo);
    }

    #[test]
    fn maps_priorities() {
        let m: HashMap<String, String> = [
            ("critical".into(), "A".into()),
            ("high".into(), "A".into()),
            ("normal".into(), "B".into()),
            ("low".into(), "C".into()),
        ]
        .into_iter()
        .collect();
        assert_eq!(map_priority("critical", &m), Some(Priority::A));
        assert_eq!(map_priority("normal", &m), Some(Priority::B));
        assert_eq!(map_priority("low", &m), Some(Priority::C));
        assert_eq!(map_priority("none", &m), None);
    }

    #[test]
    fn maps_status_out() {
        let m: HashMap<String, String> = [("DONE".into(), "completed".into())].into_iter().collect();
        assert_eq!(map_status_out("DONE", &m), "completed");
        assert_eq!(map_status_out("TODO", &m), "TODO");
    }
}
```

- [ ] **Step 2: Прогнать тесты**

```bash
cargo test --workspace sync::remote 2>&1 | tail -8
```

Expected: 4 теста PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/remote.rs
git commit -m "Интеграции: RemoteTask и маппинги статусов/приоритетов"
```

---

## Task 5: Состояние синка (`sync/state.rs`)

**Files:**
- Create: `src-tauri/src/sync/state.rs`
- Modify: `src-tauri/src/sync/mod.rs:3-4` (добавить `pub mod state;` в список модулей)

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/state.rs`**

```rust
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
        let dir = std::env::temp_dir().join(format!("logtask-syncstate-{tag}-{}", std::process::id()));
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
        st.sources
            .entry("gitea".into())
            .or_default()
            .tasks
            .insert(
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
```

- [ ] **Step 2: Объявить модуль**

В `src-tauri/src/sync/mod.rs` дополнить список модулей:

```rust
pub mod config;
pub mod secrets;
pub mod state;
```

- [ ] **Step 3: Прогнать тесты**

```bash
cargo test --workspace sync::state 2>&1 | tail -8
```

Expected: 3 теста PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sync/state.rs src-tauri/src/sync/mod.rs
git commit -m "Интеграции: состояние синхронизации в .logtask/integrations-state.json"
```

---

## Task 6: HTTP-хелпер (`sync/http.rs`)

**Files:**
- Create: `src-tauri/src/sync/http.rs`
- Modify: `src-tauri/src/sync/mod.rs` (добавить `pub mod http;`)

- [ ] **Step 1: Создать `src-tauri/src/sync/http.rs`**

```rust
//! HTTP-клиент для адаптеров: единые таймауты, User-Agent, обработка ошибок.

/// Клиент с таймаутом 20 с. Создавать на синк, переиспользовать внутри него.
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("logtask/0.1")
        .build()
        .map_err(|e| format!("http-клиент: {e}"))
}

/// GET JSON с заголовками. Не-2xx → Err с кодом и началом тела.
pub async fn get_json(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let mut req = client.get(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("GET {url}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(200).collect();
        return Err(format!("GET {url}: HTTP {status}: {short}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("GET {url}: невалидный JSON: {e}"))
}

/// Запрос с JSON-телом (POST/PUT/PATCH) для write-back. 2xx → Ok(()).
pub async fn send_json(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<(), String> {
    let method: reqwest::Method = method
        .parse()
        .map_err(|_| format!("неизвестный HTTP-метод: {method}"))?;
    let mut req = client.request(method, url).json(body);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| format!("{method} {url}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let short: String = body.chars().take(200).collect();
        return Err(format!("{method} {url}: HTTP {status}: {short}"));
    }
    Ok(())
}
```

В `src-tauri/src/sync/mod.rs`:

```rust
pub mod config;
pub mod http;
pub mod secrets;
pub mod state;
```

- [ ] **Step 2: Проверка сборки**

```bash
cargo build --workspace 2>&1 | tail -3
```

Expected: без ошибок (тесты этого модуля — через wiremock в Task 7).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/http.rs src-tauri/src/sync/mod.rs
git commit -m "Интеграции: HTTP-хелпер для адаптеров"
```

---

## Task 7: Generic-адаптер (`sync/generic.rs`)

**Files:**
- Create: `src-tauri/src/sync/generic.rs`
- Modify: `src-tauri/src/sync/mod.rs` (добавить `pub mod generic;`)

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/generic.rs`**

```rust
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
    let url = secrets::resolve(&push.url.replace("{id}", id), graph_key)?;
    let body = substitute(&push.body_template, id, &out_status);
    let headers = resolve_headers(cfg, graph_key)?;
    http::send_json(client, &push.method, &url, &headers, &body).await
}

fn resolve_headers(
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<(String, String)>, String> {
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

    fn test_config(url: &str) -> SourceConfig {
        SourceConfig {
            id: "ppdb".into(),
            kind: "generic".into(),
            name: "PPDB".into(),
            page: "PPDB - TODO".into(),
            url: url.into(),
            headers: [("Authorization".into(), "Bearer ${secret:test-tok}".into())]
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

        let cfg = test_config(&format!("{}/api/tasks", server.uri()));
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
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&server)
            .await;
        let cfg = test_config(&server.uri());
        let err = fetch(&http::client().unwrap(), &cfg, "g").await.unwrap_err();
        assert!(err.contains("401"), "ожидался код ошибки: {err}");
    }

    #[tokio::test]
    async fn push_substitutes_id_and_status() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/tasks/ppdb-9/status"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let mut cfg = test_config("http://unused".into());
        cfg.push = Some(PushConfig {
            url: format!("{}/api/tasks/{{id}}/status", server.uri()),
            method: "POST".into(),
            body_template: serde_json::json!({"status": "{status}", "task": "{id}"}),
            status_map_out: HashMap::from([("DONE".into(), "completed".into())]),
        });
        push_status(&http::client().unwrap(), &cfg, "g", "ppdb-9", Status::Done)
            .await
            .unwrap();
        // wiremock проверит expect(1) при drop
    }

    #[tokio::test]
    async fn push_without_config_is_noop() {
        let cfg = test_config("http://unused".into());
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
```

- [ ] **Step 2: Объявить модуль и прогнать тесты**

В `src-tauri/src/sync/mod.rs` добавить `pub mod generic;` в список модулей.

```bash
cargo test --workspace sync::generic 2>&1 | tail -10
```

Expected: 5 тестов PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/generic.rs src-tauri/src/sync/mod.rs
git commit -m "Интеграции: адаптер произвольного REST API (JSONPath-маппинг)"
```

---

## Task 8: Адаптеры форжей (`sync/forge.rs`)

**Files:**
- Create: `src-tauri/src/sync/forge.rs`
- Modify: `src-tauri/src/sync/mod.rs` (добавить `pub mod forge;`)

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/forge.rs`**

```rust
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
        "Gitea - {repo} - TODO"
    } else {
        &cfg.page_template
    };
    tpl.replace("{repo}", short_repo(repo))
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
    let state = cfg.state.as_deref().unwrap_or("open");
    let mut out = Vec::new();
    for repo in &cfg.repos {
        let url = format!("{base}/api/v1/repos/{repo}/issues?state={state}&limit=100&type=issues");
        let headers = tok
            .as_ref()
            .map(|t| vec![("Authorization".into(), format!("token {t}"))])
            .unwrap_or_default();
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
                url: item.get("html_url").and_then(|u| u.as_str()).map(String::from),
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
    http::send_json(client, "PATCH", &url, &headers, &serde_json::json!({"state": state})).await
}

// ---------- GitHub ----------

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
    let state = cfg.state.as_deref().unwrap_or("open");
    let mut out = Vec::new();
    for repo in &cfg.repos {
        let url = format!("{base}/repos/{repo}/issues?state={state}&per_page=100");
        let mut headers = vec![("Accept".into(), "application/vnd.github+json".into())];
        if let Some(t) = &tok {
            headers.push(("Authorization".into(), format!("Bearer {t}")));
        }
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
                url: item.get("html_url").and_then(|u| u.as_str()).map(String::from),
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
    http::send_json(client, "PATCH", &url, &headers, &serde_json::json!({"state": state})).await
}

// ---------- GitLab ----------

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
    let state = match cfg.state.as_deref().unwrap_or("open") {
        "closed" => "closed",
        "all" => "all",
        _ => "opened",
    };
    let mut out = Vec::new();
    for project in &cfg.repos {
        let enc = project.replace('/', "%2F");
        let url = format!("{base}/api/v4/projects/{enc}/issues?state={state}&per_page=100");
        let headers = tok
            .as_ref()
            .map(|t| vec![("PRIVATE-TOKEN".into(), t.clone())])
            .unwrap_or_default();
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
                status: issue_status(item.get("state").and_then(|s| s.as_str()).unwrap_or("opened")),
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
                url: item.get("web_url").and_then(|u| u.as_str()).map(String::from),
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
    http::send_json(client, "PUT", &url, &headers, &serde_json::json!({"state_event": event})).await
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
        assert_eq!(priority_from_labels(["High"].into_iter()), Some(Priority::A));
        assert_eq!(priority_from_labels(["bug", "low"].into_iter()), Some(Priority::C));
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
        let tasks = fetch_gitea(&http::client().unwrap(), &cfg, "g").await.unwrap();
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
        std::env::set_var("LOGTASK_SECRET_GITEA_TOK", "sek");
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/api/v1/repos/xpamych/logtask/issues/5"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let cfg = gitea_config(&server.uri());
        push_gitea(&http::client().unwrap(), &cfg, "g", "xpamych/logtask#5", Status::Done)
            .await
            .unwrap();
        std::env::remove_var("LOGTASK_SECRET_GITEA_TOK");
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
        let tasks = fetch_github(&http::client().unwrap(), &cfg, "g").await.unwrap();
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
        let tasks = fetch_gitlab(&http::client().unwrap(), &cfg, "g").await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "gr/pr#3");
        assert_eq!(tasks[0].priority, Some(Priority::B));
        std::env::remove_var("LOGTASK_SECRET_GL_TOK");
    }
}
```

- [ ] **Step 2: Объявить модуль и прогнать тесты**

В `src-tauri/src/sync/mod.rs` добавить `pub mod forge;` в список модулей.

```bash
cargo test --workspace sync::forge 2>&1 | tail -10
```

Expected: 6 тестов PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/forge.rs src-tauri/src/sync/mod.rs
git commit -m "Интеграции: адаптеры Gitea/Forgejo, GitHub и GitLab"
```

---

## Task 9: Merge-логика (`sync/merge.rs`)

**Files:**
- Create: `src-tauri/src/sync/merge.rs`
- Modify: `src-tauri/src/sync/mod.rs` (добавить `pub mod merge;`)

- [ ] **Step 1: Написать тесты и реализацию `src-tauri/src/sync/merge.rs`**

```rust
//! Чистая merge-логика синхронизации (без I/O).
//! Правила:
//! - менялся только сервер → Update (обновить блок);
//! - менялся только локально → Push (отправить статус на сервер);
//! - менялись оба → Conflict (сервер побеждает + свойство sync-conflict);
//! - задача исчезла с сервера: локально не тронута → Remove, иначе MarkMissing;
//! - первый синк задачи (нет TaskState): сервер — источник истины, Update
//!   без пометки конфликта (миграция со страниц, созданных плагином TE).

use super::remote::RemoteTask;
use super::state::TaskState;
use crate::core::model::Block;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Add,
    Update,
    Push,
    Conflict,
    Remove,
    MarkMissing,
    Keep,
}

/// Отпечаток блока: статус + приоритет + контент + свойства,
/// кроме служебных sync-* (они меняются каждым синком и не считаются правкой)
pub fn block_fingerprint(b: &Block) -> String {
    let mut s = String::new();
    if let Some(st) = b.status {
        s.push_str(st.to_marker());
    }
    s.push('|');
    if let Some(p) = b.priority {
        s.push_str(&format!("{p:?}"));
    }
    s.push('|');
    s.push_str(b.content.trim());
    let mut props: Vec<(&String, &String)> = b
        .props
        .iter()
        .filter(|(k, _)| !k.starts_with("sync-") && k.as_str() != "synced-at")
        .collect();
    props.sort();
    for (k, v) in props {
        s.push_str(&format!("|{k}={v}"));
    }
    super::fnv1a_hex(s.as_bytes())
}

pub fn decide(
    remote: Option<&RemoteTask>,
    block: Option<&Block>,
    prev: Option<&TaskState>,
) -> Action {
    match (remote, block, prev) {
        (Some(_), None, _) => Action::Add,
        (None, None, _) => Action::Keep,
        (None, Some(b), prev) => {
            // prev=None (задача не от нас) — консервативно считаем изменённой
            let untouched = prev
                .map(|p| p.fingerprint == block_fingerprint(b))
                .unwrap_or(false);
            if untouched {
                Action::Remove
            } else {
                Action::MarkMissing
            }
        }
        (Some(_), Some(_), None) => Action::Update,
        (Some(r), Some(b), Some(p)) => {
            let local_changed = block_fingerprint(b) != p.fingerprint;
            let remote_changed = r.status.to_marker() != p.remote_status;
            match (local_changed, remote_changed) {
                (false, false) => Action::Keep,
                (false, true) => Action::Update,
                (true, false) => Action::Push,
                (true, true) => Action::Conflict,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::model::{Priority, Status};
    use crate::core::parser::parse_document;

    fn task(id: &str, status: Status) -> RemoteTask {
        RemoteTask {
            id: id.into(),
            title: "Задача".into(),
            status,
            priority: None,
            assignee: None,
            author: None,
            created: None,
            url: None,
            page: "PPDB - TODO".into(),
        }
    }

    fn block_of(md: &str) -> Block {
        parse_document(md).blocks.into_iter().next().unwrap()
    }

    fn prev(status: &str, fp: &str) -> TaskState {
        TaskState {
            remote_status: status.into(),
            fingerprint: fp.into(),
        }
    }

    #[test]
    fn fingerprint_ignores_sync_props() {
        let a = block_of("- TODO Задача\n  source-id:: x\n");
        let b = block_of("- TODO Задача\n  source-id:: x\n  synced-at:: 2026-10-04\n  sync-conflict:: 2026-10-04\n");
        assert_eq!(block_fingerprint(&a), block_fingerprint(&b));
    }

    #[test]
    fn fingerprint_tracks_content_status_priority_props() {
        let base = block_of("- TODO Задача\n  source-id:: x\n");
        assert_ne!(block_fingerprint(&base), block_fingerprint(&block_of("- DONE Задача\n  source-id:: x\n")));
        assert_ne!(block_fingerprint(&base), block_fingerprint(&block_of("- TODO Задача другая\n  source-id:: x\n")));
        assert_ne!(block_fingerprint(&base), block_fingerprint(&block_of("- TODO [#A] Задача\n  source-id:: x\n")));
        assert_ne!(block_fingerprint(&base), block_fingerprint(&block_of("- TODO Задача\n  source-id:: x\n  url:: http://x\n")));
    }

    #[test]
    fn new_remote_task_is_added() {
        assert_eq!(decide(Some(&task("1", Status::Todo)), None, None), Action::Add);
    }

    #[test]
    fn first_sync_existing_block_updates_without_conflict() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        assert_eq!(decide(Some(&task("1", Status::Done)), Some(&b), None), Action::Update);
    }

    #[test]
    fn only_remote_changed_updates() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&b));
        assert_eq!(decide(Some(&task("1", Status::Done)), Some(&b), Some(&p)), Action::Update);
    }

    #[test]
    fn only_local_changed_pushes() {
        let local = block_of("- DONE Задача\n  source-id:: 1\n");
        // в state лежит отпечаток версии с TODO — локально поменяли
        let synced = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&synced));
        assert_eq!(decide(Some(&task("1", Status::Todo)), Some(&local), Some(&p)), Action::Push);
    }

    #[test]
    fn both_changed_is_conflict() {
        let local = block_of("- CANCELED Задача\n  source-id:: 1\n");
        let synced = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&synced));
        assert_eq!(decide(Some(&task("1", Status::Done)), Some(&local), Some(&p)), Action::Conflict);
    }

    #[test]
    fn nothing_changed_is_keep() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&b));
        assert_eq!(decide(Some(&task("1", Status::Todo)), Some(&b), Some(&p)), Action::Keep);
    }

    #[test]
    fn vanished_untouched_is_removed() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&b));
        assert_eq!(decide(None, Some(&b), Some(&p)), Action::Remove);
    }

    #[test]
    fn vanished_locally_changed_is_marked_missing() {
        let local = block_of("- DOING Задача\n  source-id:: 1\n");
        let synced = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&synced));
        assert_eq!(decide(None, Some(&local), Some(&p)), Action::MarkMissing);
    }

    #[test]
    fn vanished_unknown_block_is_marked_missing() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        assert_eq!(decide(None, Some(&b), None), Action::MarkMissing);
    }
}
```

- [ ] **Step 2: Объявить модуль и прогнать тесты**

В `src-tauri/src/sync/mod.rs` добавить `pub mod merge;` в список модулей. `parse_document` (`src-tauri/src/core/parser.rs:358`) возвращает `ParsedFile` с полем `blocks: Vec<Block>` — хелпер `block_of` выше рассчитан на это.

```bash
cargo test --workspace sync::merge 2>&1 | tail -12
```

Expected: 11 тестов PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/merge.rs src-tauri/src/sync/mod.rs
git commit -m "Интеграции: merge-логика синхронизации (конфликты в пользу сервера)"
```

---

## Task 10: Оркестратор синхронизации (`sync/mod.rs`)

**Files:**
- Modify: `src-tauri/src/sync/mod.rs` (полная замена скелета)

Ключевые моменты реализации:
- fetch идёт без блокировки графа; merge+запись страниц — под write-блокировкой, без сети; push — после записи.
- Запись блоков только через `Graph::append_block`/`mutate_block`/`delete_block` (внутри: mtime-защита, атомарная запись, переиндексация страницы).
- `apply_merge` — чистая часть (граф + список RemoteTask), тестируется без сети и без Tauri.
- После синка: сохранение state-файла, `mark_self_write` + `watcher::reindex_and_emit`, события `sync-started`/`sync-finished`.

- [ ] **Step 1: Полная версия `src-tauri/src/sync/mod.rs`**

```rust
//! Синхронизация задач с внешними источниками (docs/05-integrations.md).
//! Двусторонняя: fetch → merge → запись страниц; push статусов на сервер.

pub mod config;
pub mod forge;
pub mod generic;
pub mod http;
pub mod jsonpath;
pub mod merge;
pub mod remote;
pub mod secrets;
pub mod state;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::Emitter;

use crate::core::index::IndexStats;
use crate::core::model::{Graph, PageKind, Status};
use crate::state::AppState;
use config::SourceConfig;
use remote::RemoteTask;
use state::{SourceState, SyncState, TaskState};

/// FNV-1a хэш в hex — для ключей keyring и отпечатков блоков
pub(crate) fn fnv1a_hex(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Источники, синхронизирующиеся прямо сейчас (гонка кнопка/таймер/старт)
fn running() -> &'static Mutex<Vec<String>> {
    static R: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub source: String,
    pub added: usize,
    pub updated: usize,
    pub pushed: usize,
    pub conflicts: usize,
    pub removed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Dispatch по типу источника
pub async fn fetch_all(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
) -> Result<Vec<RemoteTask>, String> {
    match cfg.kind.as_str() {
        "generic" => generic::fetch(client, cfg, graph_key).await,
        "gitea" => forge::fetch_gitea(client, cfg, graph_key).await,
        "github" => forge::fetch_github(client, cfg, graph_key).await,
        "gitlab" => forge::fetch_gitlab(client, cfg, graph_key).await,
        other => Err(format!("неизвестный тип источника: {other:?}")),
    }
}

/// Dispatch push по типу источника
pub async fn push_status(
    client: &reqwest::Client,
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    match cfg.kind.as_str() {
        "generic" => generic::push_status(client, cfg, graph_key, id, status).await,
        "gitea" => forge::push_gitea(client, cfg, graph_key, id, status).await,
        "github" => forge::push_github(client, cfg, graph_key, id, status).await,
        "gitlab" => forge::push_gitlab(client, cfg, graph_key, id, status).await,
        other => Err(format!("неизвестный тип источника: {other:?}")),
    }
}

/// Push со свежесозданным клиентом — для write-back при смене статуса в UI
pub async fn push_status_standalone(
    cfg: &SourceConfig,
    graph_key: &str,
    id: &str,
    status: Status,
) -> Result<(), String> {
    let client = http::client()?;
    push_status(&client, cfg, graph_key, id, status).await
}

/// Синхронизирует один источник. Не паникует и не падает целиком:
/// ошибки — в SyncReport.error и в state-файл.
pub async fn sync_source(app: &tauri::AppHandle, state: &AppState, cfg: &SourceConfig) -> SyncReport {
    {
        let mut r = running().lock().unwrap();
        if r.contains(&cfg.id) {
            return SyncReport {
                source: cfg.id.clone(),
                error: Some("синхронизация уже выполняется".into()),
                ..Default::default()
            };
        }
        r.push(cfg.id.clone());
    }
    let _ = app.emit("sync-started", serde_json::json!({ "source": cfg.id }));
    let report = sync_inner(app, state, cfg).await;
    let _ = app.emit("sync-finished", &report);
    running().lock().unwrap().retain(|id| id != &cfg.id);
    report
}

async fn sync_inner(app: &tauri::AppHandle, state: &AppState, cfg: &SourceConfig) -> SyncReport {
    let mut report = SyncReport {
        source: cfg.id.clone(),
        ..Default::default()
    };
    let Some(root) = state.root.read().clone() else {
        report.error = Some("граф не загружен".into());
        return report;
    };
    let gkey = secrets::graph_key(&root);
    let client = match http::client() {
        Ok(c) => c,
        Err(e) => {
            report.error = Some(e);
            return report;
        }
    };

    // 1. fetch — без блокировки графа
    let remote = match fetch_all(&client, cfg, &gkey).await {
        Ok(t) => t,
        Err(e) => {
            state::record_error(&root, &cfg.id, Some(e.clone()));
            report.error = Some(e);
            return report;
        }
    };

    // 2. merge + запись страниц — под write-блокировкой, без сети
    let mut sync_state = state::load(&root);
    let mut pushes: Vec<(String, Status)> = vec![];
    {
        let mut guard = state.graph.write();
        let Some(graph) = guard.as_mut() else {
            report.error = Some("граф не загружен".into());
            return report;
        };
        let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
        apply_merge(graph, &root, cfg, &remote, src_state, &mut pushes, &mut report);
    }

    // 3. push локальных изменений на сервер (успешные — обновят state)
    let mut pushed_ok: HashSet<String> = HashSet::new();
    for (rid, st) in &pushes {
        match push_status(&client, cfg, &gkey, rid, *st).await {
            Ok(()) => {
                pushed_ok.insert(rid.clone());
            }
            Err(e) => {
                state::record_error(&root, &cfg.id, Some(e.clone()));
                report.error = Some(e);
            }
        }
    }
    report.pushed = pushed_ok.len();

    // 4. обновляем отпечатки/статусы в state по итоговому графу
    {
        let guard = state.graph.read();
        if let Some(graph) = guard.as_ref() {
            let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
            refresh_task_states(graph, cfg, &remote, src_state, &pushed_ok);
        }
    }
    {
        let src_state = sync_state.sources.entry(cfg.id.clone()).or_default();
        src_state.last_sync = Some(chrono::Local::now().to_rfc3339());
        if report.error.is_none() {
            src_state.last_error = None;
        }
    }
    let _ = state::save(&root, &sync_state);

    // 5. переиндексация и событие для UI
    crate::commands::mark_self_write(state);
    crate::watcher::reindex_and_emit(app);
    report
}

/// Применяет merge к графу. Чистая часть синка — тестируется без сети.
fn apply_merge(
    graph: &mut Graph,
    root: &Path,
    cfg: &SourceConfig,
    remote: &[RemoteTask],
    src_state: &mut SourceState,
    pushes: &mut Vec<(String, Status)>,
    report: &mut SyncReport,
) {
    let mut by_page: HashMap<&str, Vec<&RemoteTask>> = HashMap::new();
    for t in remote {
        by_page.entry(t.page.as_str()).or_default().push(t);
    }

    for (page, tasks) in &by_page {
        if let Err(e) = ensure_page(graph, root, page) {
            report.error = Some(format!("страница {page}: {e}"));
            continue;
        }
        let remote_ids: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        let existing = page_blocks_with_source(graph, page, &cfg.id);

        for t in tasks {
            let found = existing.iter().find(|(_, sid)| sid == &t.id).map(|(u, _)| *u);
            let block = found.and_then(|u| graph.blocks.get(&u));
            let prev = src_state.tasks.get(&t.id);
            match merge::decide(Some(t), block, prev) {
                merge::Action::Add => {
                    add_task(graph, root, page, cfg, t);
                    report.added += 1;
                }
                merge::Action::Update => {
                    if let Some(uuid) = found {
                        update_task(graph, root, &uuid, cfg, t, false);
                        report.updated += 1;
                    }
                }
                merge::Action::Push => {
                    if let Some(status) = block.and_then(|b| b.status) {
                        pushes.push((t.id.clone(), status));
                    }
                }
                merge::Action::Conflict => {
                    if let Some(uuid) = found {
                        update_task(graph, root, &uuid, cfg, t, true);
                        report.conflicts += 1;
                    }
                }
                _ => {}
            }
        }

        // исчезнувшие с сервера
        for (uuid, sid) in existing {
            if remote_ids.contains(sid.as_str()) {
                continue;
            }
            let block = graph.blocks.get(&uuid);
            let prev = src_state.tasks.get(&sid);
            match merge::decide(None, block, prev) {
                merge::Action::Remove => {
                    let _ = graph.delete_block(&uuid, root);
                    src_state.tasks.remove(&sid);
                    report.removed += 1;
                }
                merge::Action::MarkMissing => {
                    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                    let _ = graph.mutate_block(&uuid, root, |b| {
                        b.set_prop("sync-missing", Some(&today));
                    });
                }
                _ => {}
            }
        }
    }
}

/// Создаёт файл страницы, если её ещё нет (пустой — наполнится задачами)
fn ensure_page(graph: &mut Graph, root: &Path, name: &str) -> std::io::Result<()> {
    if graph.pages.contains_key(name) {
        return Ok(());
    }
    let rel = PathBuf::from(format!("pages/{name}.md"));
    let abs = root.join(&rel);
    if !abs.exists() {
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::core::fswrite::atomic_write(&abs, "")?;
    }
    let mut stats = IndexStats {
        pages: 0,
        journals: 0,
        blocks: 0,
        tasks: 0,
        links: 0,
    };
    graph.index_file_content(name, PageKind::Page, "", None, &mut stats, Some(rel));
    Ok(())
}

/// (uuid, source-id) блоков страницы, импортированных из этого источника
fn page_blocks_with_source(graph: &Graph, page: &str, source: &str) -> Vec<(uuid::Uuid, String)> {
    let Some(p) = graph.pages.get(page) else {
        return vec![];
    };
    p.order
        .iter()
        .filter_map(|id| graph.blocks.get(id).map(|b| (*id, b)))
        .filter(|(_, b)| b.props.get("source").map(|s| s.as_str()) == Some(source))
        .filter_map(|(id, b)| b.props.get("source-id").map(|sid| (id, sid.clone())))
        .collect()
}

fn task_props(cfg: &SourceConfig, t: &RemoteTask) -> Vec<(String, String)> {
    let mut v = vec![
        ("source".to_string(), cfg.id.clone()),
        ("source-id".to_string(), t.id.clone()),
        (
            "synced-at".to_string(),
            chrono::Local::now().to_rfc3339(),
        ),
    ];
    if let Some(u) = &t.url {
        v.push(("url".to_string(), u.clone()));
    }
    if let Some(a) = &t.assignee {
        v.push(("assignee".to_string(), a.clone()));
    }
    if let Some(a) = &t.author {
        v.push(("author".to_string(), a.clone()));
    }
    if let Some(c) = &t.created {
        v.push(("created".to_string(), c.clone()));
    }
    v
}

fn add_task(graph: &mut Graph, root: &Path, page: &str, cfg: &SourceConfig, t: &RemoteTask) {
    let Ok(Some(uuid)) = graph.append_block(page, t.title.trim(), Some(t.status), root) else {
        log::warn!("sync: не удалось добавить блок на страницу {page}");
        return;
    };
    let priority = t.priority;
    let props = task_props(cfg, t);
    let _ = graph.mutate_block(&uuid, root, |b| {
        b.set_priority(priority);
        for (k, v) in &props {
            b.set_prop(k, Some(v));
        }
    });
}

/// Обновляет блок по данным сервера; conflict=true — ещё и метка sync-conflict
fn update_task(
    graph: &mut Graph,
    root: &Path,
    uuid: &uuid::Uuid,
    cfg: &SourceConfig,
    t: &RemoteTask,
    conflict: bool,
) {
    let priority = t.priority;
    let props = task_props(cfg, t);
    let title = t.title.trim().to_string();
    let status = t.status;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let _ = graph.mutate_block(uuid, root, |b| {
        b.set_status(status);
        b.set_priority(priority);
        b.set_content(&title);
        for (k, v) in &props {
            b.set_prop(k, Some(v));
        }
        if conflict {
            b.set_prop("sync-conflict", Some(&today));
        } else {
            b.set_prop("sync-conflict", None);
        }
        b.set_prop("sync-missing", None);
    });
}

/// Пересчитывает TaskState по итоговому графу:
/// - remote_status — статус сервера (для успешно запушенных — запушенный);
/// - fingerprint — отпечаток текущего блока.
/// Неуспешные push не обновляются — следующий синк повторит попытку.
fn refresh_task_states(
    graph: &Graph,
    cfg: &SourceConfig,
    remote: &[RemoteTask],
    src_state: &mut SourceState,
    pushed_ok: &HashSet<String>,
) {
    for t in remote {
        let uuid = graph.blocks.iter().find_map(|(id, b)| {
            if b.props.get("source").map(|s| s.as_str()) == Some(cfg.id.as_str())
                && b.props.get("source-id").map(|s| s.as_str()) == Some(t.id.as_str())
            {
                Some(*id)
            } else {
                None
            }
        });
        let Some(uuid) = uuid else { continue };
        let Some(block) = graph.blocks.get(&uuid) else {
            continue;
        };
        let was_pushed = pushed_ok.contains(&t.id);
        // неуспешный push: оставляем старый state — синк повторит попытку
        let push_failed = block.status.map(|s| s.to_marker()) != Some(t.status.to_marker())
            && !was_pushed
            && src_state.tasks.contains_key(&t.id);
        if push_failed {
            continue;
        }
        src_state.tasks.insert(
            t.id.clone(),
            TaskState {
                remote_status: block
                    .status
                    .map(|s| s.to_marker().to_string())
                    .unwrap_or_else(|| t.status.to_marker().to_string()),
                fingerprint: merge::block_fingerprint(block),
            },
        );
    }
}

/// Синк всех включённых источников текущего графа (при старте и по кнопке)
pub async fn sync_all(app: &tauri::AppHandle) -> Vec<SyncReport> {
    let state = app.state::<AppState>();
    let Some(root) = state.root.read().clone() else {
        return vec![];
    };
    let settings = crate::settings::load(&root);
    let mut reports = vec![];
    for cfg in settings.integrations.sources.iter().filter(|s| s.enabled) {
        reports.push(sync_source(app, &state, cfg).await);
    }
    reports
}

/// Фон: начальный синк при открытии графа + тикер интервалов (раз в минуту
/// проверяет, какие источники «просрочились» по syncIntervalMin)
pub async fn startup_and_ticker(app: tauri::AppHandle) {
    sync_all(&app).await;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let state = app.state::<AppState>();
        let Some(root) = state.root.read().clone() else {
            continue;
        };
        let settings = crate::settings::load(&root);
        let st = state::load(&root);
        let now = chrono::Local::now();
        for cfg in settings
            .integrations
            .sources
            .iter()
            .filter(|s| s.enabled && s.sync_interval_min > 0)
        {
            let due = st
                .sources
                .get(&cfg.id)
                .and_then(|s| s.last_sync.as_ref())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|t| {
                    now.signed_duration_since(t.with_timezone(&chrono::Local)).num_seconds()
                        >= (cfg.sync_interval_min * 60) as i64
                })
                .unwrap_or(true);
            if due {
                sync_source(&app, &state, cfg).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::model::Priority;

    #[test]
    fn fnv1a_stable() {
        assert_eq!(fnv1a_hex(b"logtask"), fnv1a_hex(b"logtask"));
        assert_ne!(fnv1a_hex(b"a"), fnv1a_hex(b"b"));
        assert_eq!(fnv1a_hex(b"").len(), 16);
    }

    // --- интеграция apply_merge с реальным графом во временной папке ---

    fn temp_graph(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("logtask-sync-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::core::fswrite::scaffold_graph(&dir).unwrap();
        dir
    }

    fn load_graph(root: &Path) -> Graph {
        let mut g = Graph::default();
        g.index_dir(root).unwrap();
        g
    }

    fn test_cfg() -> SourceConfig {
        SourceConfig {
            id: "ppdb".into(),
            kind: "generic".into(),
            name: "PPDB".into(),
            page: "PPDB - TODO".into(),
            ..Default::default()
        }
    }

    fn task(id: &str, title: &str, status: Status) -> RemoteTask {
        RemoteTask {
            id: id.into(),
            title: title.into(),
            status,
            priority: Some(Priority::B),
            assignee: Some("xpamych".into()),
            author: None,
            created: Some("2026-07-15".into()),
            url: Some("https://x/1".into()),
            page: "PPDB - TODO".into(),
        }
    }

    fn run_merge(
        root: &Path,
        cfg: &SourceConfig,
        remote: &[RemoteTask],
        st: &mut SourceState,
    ) -> (SyncReport, Vec<(String, Status)>) {
        let mut graph = load_graph(root);
        let mut pushes = vec![];
        let mut report = SyncReport::default();
        apply_merge(&mut graph, root, cfg, remote, st, &mut pushes, &mut report);
        // обновляем state как sync_inner
        let pushed: HashSet<String> = pushes.iter().map(|(id, _)| id.clone()).collect();
        refresh_task_states(&graph, cfg, remote, st, &pushed);
        (report, pushes)
    }

    fn page_text(root: &Path, name: &str) -> String {
        std::fs::read_to_string(root.join("pages").join(format!("{name}.md")))
            .unwrap_or_default()
    }

    #[test]
    fn initial_import_creates_page_and_blocks() {
        let root = temp_graph("import");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        let remote = vec![task("ppdb-1", "Первая задача", Status::Todo)];

        let (report, pushes) = run_merge(&root, &cfg, &remote, &mut st);
        assert_eq!(report.added, 1);
        assert!(pushes.is_empty());

        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- TODO [#B] Первая задача"), "файл:\n{text}");
        assert!(text.contains("source:: ppdb"), "файл:\n{text}");
        assert!(text.contains("source-id:: ppdb-1"), "файл:\n{text}");
        assert!(text.contains("assignee:: xpamych"), "файл:\n{text}");
        assert!(st.tasks.contains_key("ppdb-1"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn second_sync_without_changes_is_noop() {
        let root = temp_graph("noop");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        let remote = vec![task("ppdb-1", "Первая задача", Status::Todo)];
        run_merge(&root, &cfg, &remote, &mut st);

        let (report, pushes) = run_merge(&root, &cfg, &remote, &mut st);
        assert_eq!(report.added, 0);
        assert_eq!(report.updated, 0);
        assert_eq!(report.removed, 0);
        assert!(pushes.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn remote_status_change_updates_block() {
        let root = temp_graph("update");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);

        let (report, _) = run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Done)], &mut st);
        assert_eq!(report.updated, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- DONE [#B] Задача"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn local_status_change_is_pushed() {
        let root = temp_graph("push");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);

        // локально меняем статус через граф (как из UI)
        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Done, &root).unwrap();
        drop(graph);

        let (_, pushes) = run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);
        assert_eq!(pushes, vec![("ppdb-1".to_string(), Status::Done)]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn conflict_server_wins_and_marks_block() {
        let root = temp_graph("conflict");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);

        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Doing, &root).unwrap();
        drop(graph);

        let (report, _) = run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Done)], &mut st);
        assert_eq!(report.conflicts, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("- DONE [#B] Задача"), "файл:\n{text}");
        assert!(text.contains("sync-conflict::"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn vanished_untouched_task_is_removed() {
        let root = temp_graph("remove");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);

        let (report, _) = run_merge(&root, &cfg, &[], &mut st);
        assert_eq!(report.removed, 1);
        let text = page_text(&root, "PPDB - TODO");
        assert!(!text.contains("ppdb-1"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn vanished_changed_task_is_marked_missing() {
        let root = temp_graph("missing");
        let cfg = test_cfg();
        let mut st = SourceState::default();
        run_merge(&root, &cfg, &[task("ppdb-1", "Задача", Status::Todo)], &mut st);

        let mut graph = load_graph(&root);
        let uuid = *graph.pages["PPDB - TODO"].order.first().unwrap();
        graph.set_block_status(&uuid, Status::Doing, &root).unwrap();
        drop(graph);

        let (report, _) = run_merge(&root, &cfg, &[], &mut st);
        assert_eq!(report.removed, 0);
        let text = page_text(&root, "PPDB - TODO");
        assert!(text.contains("sync-missing::"), "файл:\n{text}");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
```

- [ ] **Step 2: Прогнать тесты**

```bash
cargo test --workspace sync:: 2>&1 | tail -15
```

Expected: все тесты sync (включая 7 новых в `sync::tests`) PASS. Если `Block::set_status`/`set_content` имеют другую сигнатуру — свериться с `src-tauri/src/core/model.rs` (там же `set_priority`, `set_prop`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/mod.rs
git commit -m "Интеграции: оркестратор синхронизации и применение merge к графу"
```

---

## Task 11: IPC-команды и обёртки api.ts

**Files:**
- Modify: `src-tauri/src/commands.rs` (добавить команды после `settings_save`, ~строка 1028)
- Modify: `src-tauri/src/lib.rs:33-68` (регистрация)
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Команды в `src-tauri/src/commands.rs`**

Добавить после функции `settings_save`:

```rust
// ---------- Интеграции (синхронизация задач) ----------

/// Состояние источников: последний синк/ошибка (из integrations-state.json)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStateDto {
    pub id: String,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
    /// задан ли токен в keyring (только если источник его использует)
    pub secret_set: Option<bool>,
}

#[tauri::command]
pub fn integrations_states(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SourceStateDto>, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let settings = crate::settings::load(&root);
    let st = crate::sync::state::load(&root);
    let gkey = crate::sync::secrets::graph_key(&root);
    Ok(settings
        .integrations
        .sources
        .iter()
        .map(|cfg| {
            let s = st.sources.get(&cfg.id);
            SourceStateDto {
                id: cfg.id.clone(),
                last_sync: s.and_then(|x| x.last_sync.clone()),
                last_error: s.and_then(|x| x.last_error.clone()),
                secret_set: cfg
                    .token_ref
                    .as_deref()
                    .map(|t| crate::sync::secrets::is_set(&gkey, t)),
            }
        })
        .collect())
}

/// Сохраняет секрет (токен) в системное хранилище. В settings.json
/// попадает только имя (tokenRef / ${secret:имя}).
#[tauri::command]
pub fn integrations_set_secret(
    name: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    crate::sync::secrets::set(&crate::sync::secrets::graph_key(&root), &name, &value)
}

/// Проверка подключения: fetch без записи в граф. Возвращает число задач.
#[tauri::command]
pub async fn integrations_test(
    source: crate::sync::config::SourceConfig,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let client = crate::sync::http::client()?;
    let tasks = crate::sync::fetch_all(&client, &source, &crate::sync::secrets::graph_key(&root)).await?;
    Ok(tasks.len())
}

/// Ручная синхронизация: одного источника (sourceId) или всех включённых
#[tauri::command]
pub async fn integrations_sync(
    source_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::sync::SyncReport>, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let settings = crate::settings::load(&root);
    let mut reports = vec![];
    for cfg in settings
        .integrations
        .sources
        .iter()
        .filter(|s| s.enabled && source_id.as_ref().map(|id| &s.id == id).unwrap_or(true))
    {
        reports.push(crate::sync::sync_source(&app, &state, cfg).await);
    }
    Ok(reports)
}
```

- [ ] **Step 2: Регистрация в `src-tauri/src/lib.rs`**

В список `tauri::generate_handler![...]` после `commands::graph_needs_scaffold,` добавить:

```rust
            commands::integrations_states,
            commands::integrations_set_secret,
            commands::integrations_test,
            commands::integrations_sync,
```

- [ ] **Step 3: Типы и обёртки в `src/lib/api.ts`**

Расширить интерфейс `Settings` полем `integrations: IntegrationsConfig;` и добавить:

```ts
// ---------- Интеграции ----------

export interface PushConfig {
  url: string;
  method: string;
  bodyTemplate: unknown;
  statusMapOut: Record<string, string>;
}

export interface SourceConfig {
  id: string;
  type: string; // "generic" | "gitea" | "github" | "gitlab"
  name: string;
  enabled: boolean;
  page: string;
  pageTemplate: string;
  baseUrl: string;
  tokenRef: string | null;
  repos: string[];
  state: string | null;
  url: string;
  method: string;
  headers: Record<string, string>;
  itemsPath: string;
  fields: Record<string, string>;
  statusMap: Record<string, string>;
  priorityMap: Record<string, string>;
  push: PushConfig | null;
  syncIntervalMin: number;
}

export interface IntegrationsConfig {
  sources: SourceConfig[];
}

export interface SourceState {
  id: string;
  lastSync: string | null;
  lastError: string | null;
  secretSet: boolean | null;
}

export interface SyncReport {
  source: string;
  added: number;
  updated: number;
  pushed: number;
  conflicts: number;
  removed: number;
  error?: string;
}

/** Новый источник с дефолтами (для кнопки «Добавить») */
export function newSourceConfig(kind: string): SourceConfig {
  return {
    id: "",
    type: kind,
    name: "",
    enabled: true,
    page: "",
    pageTemplate: "Gitea - {repo} - TODO",
    baseUrl: "",
    tokenRef: null,
    repos: [],
    state: "open",
    url: "",
    method: "GET",
    headers: {},
    itemsPath: "",
    fields: {},
    statusMap: {},
    priorityMap: {},
    push: null,
    syncIntervalMin: 0,
  };
}

export async function integrationsStates(): Promise<SourceState[]> {
  return invoke<SourceState[]>("integrations_states");
}

export async function integrationsSetSecret(name: string, value: string): Promise<void> {
  await invoke<void>("integrations_set_secret", { name, value });
}

export async function integrationsTest(source: SourceConfig): Promise<number> {
  return invoke<number>("integrations_test", { source });
}

export async function integrationsSync(sourceId?: string): Promise<SyncReport[]> {
  return invoke<SyncReport[]>("integrations_sync", { sourceId: sourceId ?? null });
}
```

- [ ] **Step 4: Проверка**

```bash
cargo build --workspace 2>&1 | tail -3
npm run typecheck 2>&1 | tail -3
```

Expected: обе команды без ошибок (typecheck упадёт на `Settings.integrations` в местах, где собирается Settings-литерал, — если есть такие места, добавить `integrations: { sources: [] }`; найти: `grep -rn "homeView" src/ --include=*.tsx`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "Интеграции: IPC-команды и типизированные обёртки во фронтенде"
```

---

## Task 12: Write-back при смене статуса (`task_set_status`)

**Files:**
- Modify: `src-tauri/src/commands.rs:762-792` (`task_set_status`)

- [ ] **Step 1: Добавить хук push в `task_set_status`**

В `src-tauri/src/commands.rs` в функции `task_set_status` заменить хвост (после `let Some(page) = page else {...};`) на:

```rust
    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };

    // импортированная задача? (source:: + source-id::) — тогда write-back
    let push_info = {
        let graph = state.graph.read();
        graph.as_ref().and_then(|g| g.blocks.get(&id)).and_then(|b| {
            let src = b.props.get("source")?.clone();
            let rid = b.props.get("source-id")?.clone();
            Some((src, rid))
        })
    };

    // переиндексируем и оповестим UI
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);

    if let Some((src, rid)) = push_info {
        tauri::async_runtime::spawn(async move {
            let settings = crate::settings::load(std::path::Path::new(&root));
            let Some(cfg) = settings
                .integrations
                .sources
                .iter()
                .find(|s| s.id == src && s.enabled)
            else {
                return;
            };
            let gkey = crate::sync::secrets::graph_key(std::path::Path::new(&root));
            if let Err(e) =
                crate::sync::push_status_standalone(cfg, &gkey, &rid, status).await
            {
                log::warn!("push статуса {rid} в {src}: {e}");
                crate::sync::state::record_error(std::path::Path::new(&root), &src, Some(e));
            }
        });
    }
    Ok(page)
}
```

Внимание: `root` в функции уже есть (`let root = state.root.read().clone()...` в начале) — хук использует его; `status` (Status, Copy) тоже в scope. Блок `let page = { ... graph.set_block_status(...) }` и проверка `id` остаются как были.

- [ ] **Step 2: Проверка**

```bash
cargo build --workspace 2>&1 | tail -3
cargo clippy --workspace 2>&1 | tail -3
```

Expected: без ошибок и предупреждений.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "Интеграции: мгновенный write-back статуса на сервер при смене в UI"
```

---

## Task 13: Фон — синк при загрузке графа и тикер интервалов

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/commands.rs:144-197` (`graph_load`), `:225-230` (`graph_close`)

- [ ] **Step 1: Поле в `AppState`**

В `src-tauri/src/state.rs`:

```rust
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
```

- [ ] **Step 2: Запуск фона в `graph_load`, остановка в `graph_close`**

В `graph_load` после блока перезапуска watcher (`if let Err(e) = crate::watcher::spawn_for_current(&app) {...}`) добавить:

```rust
    // фоновая синхронизация интеграций: стартовый прогон + тикер интервалов
    if let Some(handle) = state.sync_task.lock().take() {
        handle.abort();
    }
    let app_bg = app.clone();
    *state.sync_task.lock() = Some(tauri::async_runtime::spawn(async move {
        crate::sync::startup_and_ticker(app_bg).await;
    }));
```

В `graph_close`:

```rust
#[tauri::command]
pub fn graph_close(state: tauri::State<'_, AppState>) {
    if let Some(handle) = state.sync_task.lock().take() {
        handle.abort();
    }
    *state.watcher.write() = None;
    *state.graph.write() = None;
    *state.root.write() = None;
}
```

- [ ] **Step 3: Проверка**

```bash
cargo build --workspace 2>&1 | tail -3 && cargo clippy --workspace 2>&1 | tail -3 && cargo test --workspace 2>&1 | grep -E "test result" | tail -12
```

Expected: сборка и clippy чистые; все тесты PASS (включая старые — roundtrip не сломан).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/commands.rs
git commit -m "Интеграции: фоновая синхронизация при открытии графа и по интервалу"
```

---

## Task 14: UI — секция «Интеграции» в настройках

**Files:**
- Create: `src/components/IntegrationSources.tsx`
- Modify: `src/components/SettingsModal.tsx` (импорт + рендер секции)
- Modify: `public/styles/global.css` (стили секции)

Секция работает как секция статусов: источники редактируются в `draft().integrations.sources` и сохраняются общей кнопкой «Сохранить» модалки. Кнопки «Проверить»/«Синхронизировать»/сохранение токена — прямые IPC. Форма раскрывается по клику на источник; поля зависят от типа (generic vs форжи).

- [ ] **Step 1: Создать `src/components/IntegrationSources.tsx`**

```tsx
import { createSignal, For, Show, onMount } from "solid-js";
import {
  integrationsSetSecret,
  integrationsStates,
  integrationsSync,
  integrationsTest,
  newSourceConfig,
  SourceConfig,
  SourceState,
} from "~/lib/api";

const KIND_LABELS: Record<string, string> = {
  generic: "Произвольный API",
  gitea: "Gitea / Forgejo",
  github: "GitHub",
  gitlab: "GitLab",
};

/** Секция «Интеграции» настроек: список источников + форма редактирования */
export function IntegrationSources(props: {
  sources: SourceConfig[];
  onChange: (sources: SourceConfig[]) => void;
}) {
  const [states, setStates] = createSignal<SourceState[]>([]);
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [tokenDraft, setTokenDraft] = createSignal("");

  const refreshStates = async () => {
    try {
      setStates(await integrationsStates());
    } catch {
      /* вне Tauri / граф не загружен */
    }
  };
  onMount(refreshStates);

  const stateOf = (id: string) => states().find((s) => s.id === id);

  const update = (idx: number, patch: Partial<SourceConfig>) => {
    const next = props.sources.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    props.onChange(next);
  };

  const remove = (idx: number) => {
    props.onChange(props.sources.filter((_, i) => i !== idx));
  };

  const add = (kind: string) => {
    const s = newSourceConfig(kind);
    s.id = `${kind}-${Date.now().toString(36)}`;
    s.name = KIND_LABELS[kind] ?? kind;
    props.onChange([...props.sources, s]);
    setOpenId(s.id);
  };

  const testConnection = async (s: SourceConfig) => {
    setNotice("Проверка подключения…");
    try {
      const n = await integrationsTest(s);
      setNotice(`«${s.name}»: подключение ok, задач: ${n}`);
    } catch (e) {
      setNotice(`«${s.name}»: ошибка — ${e}`);
    }
  };

  const syncOne = async (s: SourceConfig) => {
    setNotice(`Синхронизация «${s.name}»…`);
    try {
      const reports = await integrationsSync(s.id);
      const r = reports[0];
      setNotice(
        r?.error
          ? `«${s.name}»: ошибка — ${r.error}`
          : `«${s.name}»: +${r?.added ?? 0} обновлено ${r?.updated ?? 0}, конфликтов ${r?.conflicts ?? 0}`,
      );
      await refreshStates();
    } catch (e) {
      setNotice(`«${s.name}»: ошибка — ${e}`);
    }
  };

  const saveToken = async (s: SourceConfig) => {
    const name = s.tokenRef?.trim();
    const value = tokenDraft().trim();
    if (!name || !value) return;
    try {
      await integrationsSetSecret(name, value);
      setTokenDraft("");
      setNotice(`Токен «${name}» сохранён в системном хранилище`);
      await refreshStates();
    } catch (e) {
      setNotice(`Токен не сохранён: ${e}`);
    }
  };

  return (
    <>
      <div class="settings-section">Интеграции</div>
      <p class="integration-hint">
        Синхронизация задач из внешних источников на страницы графа. Токены
        хранятся в системном хранилище ключей, в настройках — только имена.
      </p>

      <For each={props.sources}>
        {(s, idx) => (
          <div class="integration">
            <div class="integration-head">
              <input
                type="checkbox"
                checked={s.enabled}
                title="Включён"
                onChange={(e) => update(idx(), { enabled: e.currentTarget.checked })}
              />
              <button
                class="integration-title"
                onClick={() => setOpenId(openId() === s.id ? null : s.id)}
              >
                {s.name || s.id} <span class="integration-kind">{KIND_LABELS[s.type] ?? s.type}</span>
              </button>
              <Show when={stateOf(s.id)?.lastError}>
                <span class="integration-error" title={stateOf(s.id)?.lastError ?? ""}>
                  ошибка
                </span>
              </Show>
              <span class="integration-last">
                {stateOf(s.id)?.lastSync
                  ? new Date(stateOf(s.id)!.lastSync!).toLocaleString("ru-RU")
                  : "ещё не синхронизирован"}
              </span>
            </div>

            <Show when={openId() === s.id}>
              <div class="integration-form">
                <label class="settings-row">
                  <span class="settings-label">Название</span>
                  <input
                    class="settings-select"
                    value={s.name}
                    onInput={(e) => update(idx(), { name: e.currentTarget.value })}
                  />
                </label>

                <Show when={s.type === "generic"}>
                  <label class="settings-row">
                    <span class="settings-label">Страница</span>
                    <input
                      class="settings-select"
                      placeholder="PPDB - TODO"
                      value={s.page}
                      onInput={(e) => update(idx(), { page: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">URL задач</span>
                    <input
                      class="settings-select"
                      placeholder="https://…/api/tasks"
                      value={s.url}
                      onInput={(e) => update(idx(), { url: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">JSONPath массива</span>
                    <input
                      class="settings-select"
                      placeholder="$.tasks[*]"
                      value={s.itemsPath}
                      onInput={(e) => update(idx(), { itemsPath: e.currentTarget.value })}
                    />
                  </label>
                  <p class="integration-hint">
                    Поля (fields), маппинги (statusMap/priorityMap), заголовки и
                    write-back (push) пока редактируются вручную в
                    .logtask/settings.json — формат: docs/05-integrations.md.
                  </p>
                </Show>

                <Show when={s.type !== "generic"}>
                  <label class="settings-row">
                    <span class="settings-label">Адрес сервера</span>
                    <input
                      class="settings-select"
                      placeholder={s.type === "github" ? "https://api.github.com" : "https://git.example.com"}
                      value={s.baseUrl}
                      onInput={(e) => update(idx(), { baseUrl: e.currentTarget.value })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">Репозитории (owner/repo, через запятую)</span>
                    <input
                      class="settings-select"
                      value={s.repos.join(", ")}
                      onInput={(e) =>
                        update(idx(), {
                          repos: e.currentTarget.value
                            .split(",")
                            .map((r) => r.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">Имя токена (tokenRef)</span>
                    <input
                      class="settings-select"
                      placeholder="gitea-alr"
                      value={s.tokenRef ?? ""}
                      onInput={(e) => update(idx(), { tokenRef: e.currentTarget.value || null })}
                    />
                  </label>
                  <label class="settings-row">
                    <span class="settings-label">
                      Токен {stateOf(s.id)?.secretSet ? "(задан)" : "(не задан)"}
                    </span>
                    <input
                      class="settings-select"
                      type="password"
                      placeholder="введите новый токен"
                      value={tokenDraft()}
                      onInput={(e) => setTokenDraft(e.currentTarget.value)}
                    />
                  </label>
                  <div class="settings-row">
                    <span class="settings-label" />
                    <button class="btn" onClick={() => saveToken(s)}>
                      Сохранить токен
                    </button>
                  </div>
                </Show>

                <label class="settings-row">
                  <span class="settings-label">Интервал синка, мин (0 — выкл)</span>
                  <input
                    class="settings-select"
                    type="number"
                    min="0"
                    value={s.syncIntervalMin}
                    onInput={(e) =>
                      update(idx(), { syncIntervalMin: Number(e.currentTarget.value) || 0 })
                    }
                  />
                </label>

                <div class="integration-actions">
                  <button class="btn" onClick={() => testConnection(s)}>
                    Проверить подключение
                  </button>
                  <button class="btn" onClick={() => syncOne(s)}>
                    Синхронизировать
                  </button>
                  <button class="btn integration-delete" onClick={() => remove(idx())}>
                    Удалить
                  </button>
                </div>
              </div>
            </Show>
          </div>
        )}
      </For>

      <div class="integration-add">
        <For each={Object.entries(KIND_LABELS)}>
          {([kind, label]) => (
            <button class="btn" onClick={() => add(kind)}>
              + {label}
            </button>
          )}
        </For>
      </div>

      <Show when={notice()}>
        <p class="integration-notice">{notice()}</p>
      </Show>
    </>
  );
}
```

- [ ] **Step 2: Подключить секцию в `SettingsModal.tsx`**

В начало файла добавить импорт:

```tsx
import { IntegrationSources } from "./IntegrationSources";
```

Перед закрывающим `</div>` элемента `.modal-body` (после секции «Статусы канбана», ~строка 228) добавить:

```tsx
          <IntegrationSources
            sources={draft().integrations?.sources ?? []}
            onChange={(sources) =>
              setDraft((d) => ({ ...d, integrations: { sources } }))
            }
          />
```

- [ ] **Step 3: Стили в `public/styles/global.css`**

Добавить в конец файла:

```css
/* ---------- Интеграции (настройки) ---------- */

.integration {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 8px;
  padding: 6px 8px;
}

.integration-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.integration-title {
  background: none;
  border: none;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  padding: 2px 0;
  text-align: left;
  flex: 1;
}

.integration-title:hover {
  color: var(--accent);
}

.integration-kind {
  color: var(--fg-muted);
  font-size: 0.85em;
  margin-left: 6px;
}

.integration-last {
  color: var(--fg-muted);
  font-size: 0.8em;
  white-space: nowrap;
}

.integration-error {
  color: var(--danger);
  font-size: 0.8em;
  white-space: nowrap;
}

.integration-form {
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding-top: 6px;
}

.integration-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.integration-delete {
  margin-left: auto;
  color: var(--danger);
}

.integration-add {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.integration-hint {
  color: var(--fg-muted);
  font-size: 0.85em;
  margin: 4px 0 8px;
}

.integration-notice {
  color: var(--accent);
  font-size: 0.9em;
  margin-top: 8px;
}
```

- [ ] **Step 4: Проверка**

```bash
npm run build 2>&1 | tail -5
```

Expected: `tsc --noEmit` и `vite build` без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/components/IntegrationSources.tsx src/components/SettingsModal.tsx public/styles/global.css
git commit -m "Интеграции: секция в настройках со списком источников и проверкой подключения"
```

---

## Task 15: UI — кнопка синхронизации в сайдбаре, прогресс и toast

**Files:**
- Modify: `src/components/Sidebar.tsx` (пропсы + кнопка рядом с «⚙», строки 66-82)
- Modify: `src/App.tsx` (сигналы, слушатели `sync-*`, обработчик, пропсы Sidebar, рендер toast)
- Modify: `public/styles/global.css` (спиннер, бейдж, toast)

- [ ] **Step 1: Кнопка в `Sidebar.tsx`**

В сигнатуру пропсов компонента (строки 6-19) добавить:

```tsx
  onSync: () => void;
  syncing: boolean;
  syncConflicts: number;
```

В блок `.sidebar-graph` рядом с кнопкой «⚙» (перед ней) добавить:

```tsx
        <button
          class="settings-btn"
          classList={{ spin: props.syncing }}
          title="Синхронизировать задачи из интеграций"
          onClick={props.onSync}
        >
          ⟳
          <Show when={props.syncConflicts > 0}>
            <span class="sync-badge">{props.syncConflicts}</span>
          </Show>
        </button>
```

Убедиться, что `Show` импортирован из `solid-js` (в файле уже используется).

- [ ] **Step 2: Логика в `App.tsx`**

Рядом с другими сигналами (~строка 62) добавить:

```tsx
const [syncing, setSyncing] = createSignal(false);
const [syncConflicts, setSyncConflicts] = createSignal(0);
const [toast, setToast] = createSignal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const showToast = (text: string) => {
  setToast(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToast(null), 6000);
};

const runSync = async () => {
  setSyncing(true);
  try {
    const { integrationsSync } = await import("~/lib/api");
    const reports = await integrationsSync();
    const conflicts = reports.reduce((n, r) => n + r.conflicts, 0);
    setSyncConflicts(conflicts);
    const errors = reports.filter((r) => r.error);
    if (reports.length === 0) {
      showToast("Интеграции не настроены — добавьте источник в настройках");
    } else if (errors.length > 0) {
      showToast(`Синхронизация: ошибки в ${errors.map((r) => r.source).join(", ")}`);
    } else {
      const added = reports.reduce((n, r) => n + r.added, 0);
      const updated = reports.reduce((n, r) => n + r.updated, 0);
      showToast(
        `Синхронизировано: новых ${added}, обновлено ${updated}` +
          (conflicts > 0 ? `, конфликтов ${conflicts}` : ""),
      );
    }
  } catch (e) {
    showToast(`Синхронизация не удалась: ${e}`);
  } finally {
    setSyncing(false);
  }
};
```

В `listenGraphChanged`-блок (или рядом, в `onMount`) добавить слушатели фоновых синков:

```tsx
const listenSyncEvents = async () => {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("sync-started", () => setSyncing(true));
    await listen<{ source: string; conflicts: number; error?: string }>(
      "sync-finished",
      (e) => {
        setSyncing(false);
        if (e.payload.error) {
          showToast(`Синхронизация «${e.payload.source}»: ${e.payload.error}`);
        }
        if (e.payload.conflicts > 0) {
          setSyncConflicts((n) => n + e.payload.conflicts);
        }
      },
    );
  } catch {
    /* вне Tauri */
  }
};
```

Вызвать `void listenSyncEvents();` в `onMount` рядом с `void listenGraphChanged();` (~строка 209).

В рендер `<Sidebar … />` (строки 361-373) добавить пропсы:

```tsx
        onSync={() => void runSync()}
        syncing={syncing()}
        syncConflicts={syncConflicts()}
```

Перед закрывающим корневым `</div>` приложения добавить toast:

```tsx
      <Show when={toast()}>
        <div class="toast">{toast()}</div>
      </Show>
```

- [ ] **Step 3: Стили в `public/styles/global.css`**

```css
/* ---------- Синхронизация интеграций ---------- */

@keyframes sync-spin {
  to {
    transform: rotate(360deg);
  }
}

.settings-btn.spin {
  animation: sync-spin 1s linear infinite;
  position: relative;
}

.sync-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--warning);
  color: var(--bg);
  border-radius: 50%;
  font-size: 10px;
  line-height: 14px;
  min-width: 14px;
  text-align: center;
  animation: none;
}

.toast {
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: var(--bg-panel);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  max-width: 360px;
  z-index: 1000;
  box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
}
```

- [ ] **Step 4: Проверка**

```bash
npm run build 2>&1 | tail -5
```

Expected: без ошибок. Если в `Sidebar.tsx` пропсы деструктурированы по-другому — поправить под реальный стиль файла.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx public/styles/global.css
git commit -m "Интеграции: кнопка синхронизации в сайдбаре, индикатор и toast"
```

---

## Task 16: Документация и финальные проверки

**Files:**
- Create: `docs/05-integrations.md`
- Modify: `docs/01-architecture.md` (слой sync)
- Modify: `AGENTS.md` (структура, IPC, зависимости)
- Modify: `README.md` (если есть список возможностей — добавить пункт про интеграции)

- [ ] **Step 1: Создать `docs/05-integrations.md`**

```markdown
# 05 — Интеграции (синхронизация задач)

Раздел «Интеграции» в настройках: двусторонняя синхронизация задач из внешних
источников — произвольных REST API (по аналогии с Logseq-плагином TE) и issues
git-форжей (Gitea/Forgejo, GitHub, GitLab, включая self-hosted).

## Источники

Конфигурация — в `.logtask/settings.json`, ключ `integrations.sources[]`.
Редактируется в UI (Настройки → Интеграции); расширенные поля generic-источника
(fields/statusMap/priorityMap/headers/push) — пока вручную в файле.

Поля источника (camelCase в JSON):

| Поле | Типы | Описание |
|---|---|---|
| `id` | все | стабильный id (латиница); пишется в свойство блока `source::` |
| `type` | все | `generic` / `gitea` / `github` / `gitlab` |
| `name` | все | отображаемое имя |
| `enabled` | все | вкл/выкл |
| `syncIntervalMin` | все | интервал фонового синка, мин; 0 — выкл |
| `page` | generic | страница задач, например `PPDB - TODO` |
| `pageTemplate` | форжи | шаблон страницы, `{repo}` = имя репозитория |
| `baseUrl` | форжи | адрес сервера (github может быть пустым = api.github.com) |
| `tokenRef` | форжи | имя токена в системном keyring |
| `repos` | форжи | `owner/repo` (gitlab: `group/project`) |
| `state` | форжи | `open` / `closed` / `all` |
| `url`, `method`, `headers` | generic | запрос задач; значения могут содержать `${secret:имя}` |
| `itemsPath` | generic | JSONPath до массива задач |
| `fields` | generic | JSONPath до полей: `id/title/status/priority/assignee/author/created/url` |
| `statusMap` | generic | значение сервера → маркер Logseq |
| `priorityMap` | generic | значение сервера → буква A/B/C |
| `push` | generic | write-back: `url` (с `{id}`), `method`, `bodyTemplate` (с `{id}`/`{status}`), `statusMapOut` |

JSONPath — подмножество: `$.a.b`, `$.a[0]`, `$.a[*]`, `$.a[*].b`.

## Секреты

Токены — в системном хранилище ключей (Secret Service / Keychain / Credential
Manager), сервис `logtask`, ключ `<хэш пути графа>/<имя>`. В файлах графа
секретов нет. В generic-конфиге значение подставляется из `${secret:имя}`.
Для тестов/CI: переменные окружения `LOGTASK_SECRET_<ИМЯ>`.

## Страницы задач

Импорт пишет обычные Logseq-блоки (формат не меняется, docs/02-format.md):

```
- TODO [#B] Название задачи
  source:: ppdb
  source-id:: ppdb-347
  url:: https://…
  assignee:: xpamych
  created:: 2026-07-15
  synced-at:: 2026-10-04T12:00:00+03:00
```

Служебные пометки: `sync-conflict:: <дата>` (конфликт, сервер победил),
`sync-missing:: <дата>` (задача исчезла с сервера, локально изменена).
Обе находятся через Запросы по свойству.

## Синхронизация

Триггеры: при открытии графа, по интервалу (`syncIntervalMin`), кнопка ⟳ в
сайдбаре (и в секции Интеграций), мгновенный write-back при смене статуса
импортированной задачи.

Состояние — `.logtask/integrations-state.json` (по каждой задаче: серверный
статус и отпечаток блока на момент синка). Правила merge:

- менялся только сервер → блок обновляется;
- менялся только локально → статус отправляется на сервер;
- менялись оба → сервер побеждает + `sync-conflict::`;
- исчезла с сервера: не тронута → удаляется; изменена → `sync-missing::`.

Ошибка одного источника не прерывает остальные; страницы при неуспешном fetch
не трогаются. После синка — переиндексация и событие `graph-changed`; прогресс
— события `sync-started` / `sync-finished`.

## Маппинги по умолчанию (форжи)

Статус: open → `TODO`, closed → `DONE`. Приоритет из labels:
`critical`/`high` → `[#A]`, `normal`/`medium` → `[#B]`, `low` → `[#C]`.
Write-back: DONE/CANCELED закрывает issue, остальные статусы — открывает.

## IPC

`integrations_states`, `integrations_set_secret`, `integrations_test`,
`integrations_sync` (+ `settings_get`/`settings_save` для самих источников).
```

- [ ] **Step 2: Дополнить `docs/01-architecture.md`**

В раздел про хост-приложение (слой Tauri) добавить пункт:

```markdown
- `sync/` — синхронизация задач с внешними источниками (docs/05-integrations.md):
  адаптеры generic/gitea/github/gitlab, merge с защитой от конфликтов,
  состояние в `.logtask/integrations-state.json`, токены в системном keyring.
  Запись в граф — только через Graph::mutate_block/append_block/delete_block.
```

- [ ] **Step 3: Дополнить `AGENTS.md`**

1. В раздел «Хост-приложение (Tauri 2)» после `recent.rs`/`state.rs` добавить:

```markdown
  - `sync/` — интеграции: синхронизация задач из внешних API и git-форжей
    (docs/05-integrations.md). Токены — в системном keyring (крейт keyring),
    в settings.json только имена. Состояние — `.logtask/integrations-state.json`.
```

2. В раздел «Соглашения по коду» → «Новая IPC-команда» ничего не менять (соглашение соблюдено).

3. В список зависимостей/стека при необходимости: HTTP — reqwest (rustls), async — tokio, моки в тестах — wiremock.

- [ ] **Step 4: Финальные проверки**

```bash
cargo fmt
cargo fmt --check
cargo clippy --workspace 2>&1 | tail -3
cargo test --workspace 2>&1 | grep -E "test result" 
npm run build 2>&1 | tail -3
```

Expected: fmt чистый; clippy — 0 предупреждений; все наборы тестов ok (включая `roundtrip` — критично); `tsc` + `vite build` без ошибок.

- [ ] **Step 5: Commit и push**

```bash
git add docs/05-integrations.md docs/01-architecture.md AGENTS.md README.md
git commit -m "Документация: интеграции (05-integrations.md, архитектура, AGENTS.md)"
git push
```

---

## Самопроверка плана (выполнена автором)

- **Покрытие спеки:** конфиг (Task 1) ✔, keyring (2) ✔, JSONPath (3, с зафиксированным отступлением) ✔, RemoteTask/маппинги (4) ✔, state-файл (5) ✔, HTTP (6) ✔, generic (7) ✔, gitea/github/gitlab (8) ✔, merge + все ветки (9) ✔, оркестратор + события + фон (10, 13) ✔, IPC (11) ✔, write-back при смене статуса (12) ✔, UI настройки (14) ✔, кнопка/прогресс/конфликты (15) ✔, доки (16) ✔. Параллельные синки одного источника — мьютекс `running()` в Task 10 ✔.
- **Типы и имена согласованы:** `SourceConfig` (Rust) ↔ `SourceConfig` (TS) по serde camelCase; `SyncReport`/`SourceStateDto` ↔ `SyncReport`/`SourceState`; `fetch_all`/`push_status`/`push_status_standalone`/`sync_source`/`sync_all`/`startup_and_ticker` используются единообразно в Task 10-13; `merge::decide`/`Action` — в Task 9 и 10; `state::load/save/record_error` — в Task 5, 10, 12, 13; `secrets::graph_key/get/set/is_set/resolve` — в Task 2, 7, 8, 10, 11, 12.
- **Проверить при исполнении:** сигнатуры `Block::set_status`/`set_content` (Task 10 Step 2), реальный стиль пропсов в `Sidebar.tsx` (Task 15 Step 4), места сборки `Settings`-литерала в TS (Task 11 Step 4).
