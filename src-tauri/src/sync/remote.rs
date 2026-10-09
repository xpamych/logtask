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
    /// веха/версия релиза, к которой привязана задача (например "1.4.0")
    pub milestone: Option<String>,
    /// страница назначения в графе (для форжей зависит от репозитория)
    pub page: String,
}

/// Значение сервера → Status по таблице из конфига. Неизвестное → Todo.
/// Значение сервера → Status (по таблице конфига; валидный маркер Logseq
/// проходит как есть — для API, отдающих Logseq-статусы напрямую)
pub fn map_status(value: &str, map: &HashMap<String, String>) -> Status {
    map.get(value)
        .and_then(|m| Status::from_marker(m))
        .or_else(|| Status::from_marker(value))
        .unwrap_or(Status::Todo)
}

/// Значение сервера → Priority ("A"/"B"/"C" в таблице конфига;
/// готовая буква A/B/C проходит как есть)
pub fn map_priority(value: &str, map: &HashMap<String, String>) -> Option<Priority> {
    match map.get(value).map(|s| s.as_str()).unwrap_or(value) {
        "A" => Some(Priority::A),
        "B" => Some(Priority::B),
        "C" => Some(Priority::C),
        _ => None,
    }
}

/// Маркер Logseq → значение для сервера (обратный маппинг для push).
/// Нет записи в таблице — отправляется сам маркер.
pub fn map_status_out(marker: &str, map: &HashMap<String, String>) -> String {
    map.get(marker)
        .cloned()
        .unwrap_or_else(|| marker.to_string())
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
    fn logseq_markers_pass_through_without_map() {
        // API отдаёт готовые маркеры — таблица не нужна
        let empty = HashMap::new();
        assert_eq!(map_status("DOING", &empty), Status::Doing);
        assert_eq!(map_status("CANCELED", &empty), Status::Canceled);
        assert_eq!(map_priority("A", &empty), Some(Priority::A));
        assert_eq!(map_priority("C", &empty), Some(Priority::C));
        assert_eq!(map_priority("high", &empty), None);
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
        let m: HashMap<String, String> =
            [("DONE".into(), "completed".into())].into_iter().collect();
        assert_eq!(map_status_out("DONE", &m), "completed");
        assert_eq!(map_status_out("TODO", &m), "TODO");
    }
}
