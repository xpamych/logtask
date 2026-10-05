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
    use crate::core::model::Status;
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
        assert_ne!(
            block_fingerprint(&base),
            block_fingerprint(&block_of("- DONE Задача\n  source-id:: x\n"))
        );
        assert_ne!(
            block_fingerprint(&base),
            block_fingerprint(&block_of("- TODO Задача другая\n  source-id:: x\n"))
        );
        assert_ne!(
            block_fingerprint(&base),
            block_fingerprint(&block_of("- TODO [#A] Задача\n  source-id:: x\n"))
        );
        assert_ne!(
            block_fingerprint(&base),
            block_fingerprint(&block_of(
                "- TODO Задача\n  source-id:: x\n  url:: http://x\n"
            ))
        );
    }

    #[test]
    fn new_remote_task_is_added() {
        assert_eq!(
            decide(Some(&task("1", Status::Todo)), None, None),
            Action::Add
        );
    }

    #[test]
    fn first_sync_existing_block_updates_without_conflict() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        assert_eq!(
            decide(Some(&task("1", Status::Done)), Some(&b), None),
            Action::Update
        );
    }

    #[test]
    fn only_remote_changed_updates() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&b));
        assert_eq!(
            decide(Some(&task("1", Status::Done)), Some(&b), Some(&p)),
            Action::Update
        );
    }

    #[test]
    fn only_local_changed_pushes() {
        let local = block_of("- DONE Задача\n  source-id:: 1\n");
        // в state лежит отпечаток версии с TODO — локально поменяли
        let synced = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&synced));
        assert_eq!(
            decide(Some(&task("1", Status::Todo)), Some(&local), Some(&p)),
            Action::Push
        );
    }

    #[test]
    fn both_changed_is_conflict() {
        let local = block_of("- CANCELED Задача\n  source-id:: 1\n");
        let synced = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&synced));
        assert_eq!(
            decide(Some(&task("1", Status::Done)), Some(&local), Some(&p)),
            Action::Conflict
        );
    }

    #[test]
    fn nothing_changed_is_keep() {
        let b = block_of("- TODO Задача\n  source-id:: 1\n");
        let p = prev("TODO", &block_fingerprint(&b));
        assert_eq!(
            decide(Some(&task("1", Status::Todo)), Some(&b), Some(&p)),
            Action::Keep
        );
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
