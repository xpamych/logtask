use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
use futures_util::StreamExt;
use tauri::AppHandle;

use crate::shortcuts::ShortcutAction;

#[derive(Debug, PartialEq, Eq)]
enum RestoreDecision {
    Bind,
    Subscribe,
}

struct ShortcutSpec {
    id: &'static str,
    description: &'static str,
    preferred_trigger: &'static str,
}

fn preferred_shortcuts() -> [ShortcutSpec; 3] {
    [
        ShortcutSpec {
            id: "open",
            description: "Показать Logtask",
            preferred_trigger: "CTRL+ALT+SPACE",
        },
        ShortcutSpec {
            id: "today",
            description: "Открыть сегодняшний журнал",
            preferred_trigger: "CTRL+ALT+J",
        },
        ShortcutSpec {
            id: "new-task",
            description: "Создать задачу",
            preferred_trigger: "CTRL+ALT+N",
        },
    ]
}

fn is_missing_shortcuts_field(error: &str) -> bool {
    error.contains("missing field shortcuts")
}

fn validate_bound_shortcuts(bound_shortcut_ids: &[&str]) -> Result<(), String> {
    let missing: Vec<_> = preferred_shortcuts()
        .iter()
        .filter(|required| !bound_shortcut_ids.contains(&required.id))
        .map(|required| required.id)
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "система не назначила глобальные сочетания: {}",
            missing.join(", ")
        ))
    }
}

fn restore_decision(saved_shortcut_ids: &[&str]) -> RestoreDecision {
    if preferred_shortcuts()
        .iter()
        .any(|required| !saved_shortcut_ids.contains(&required.id))
    {
        RestoreDecision::Bind
    } else {
        RestoreDecision::Subscribe
    }
}

async fn run(app: AppHandle) -> Result<(), String> {
    let portal = GlobalShortcuts::new()
        .await
        .map_err(|error| format!("не удалось подключиться к XDG GlobalShortcuts: {error}"))?;
    let session = portal
        .create_session()
        .await
        .map_err(|error| format!("не удалось создать сессию XDG GlobalShortcuts: {error}"))?;
    let mut activated = portal
        .receive_activated()
        .await
        .map_err(|error| format!("не удалось подписаться на Activated: {error}"))?;

    let saved = portal
        .list_shortcuts(&session)
        .await
        .map_err(|error| format!("не удалось запросить ListShortcuts: {error}"))?
        .response()
        .map_err(|error| format!("ListShortcuts отклонён: {error}"))?;
    let saved_shortcut_ids: Vec<_> = saved
        .shortcuts()
        .iter()
        .map(|shortcut| shortcut.id())
        .collect();
    if restore_decision(&saved_shortcut_ids) == RestoreDecision::Bind {
        let shortcuts: Vec<_> = preferred_shortcuts()
            .into_iter()
            .map(|shortcut| {
                NewShortcut::new(shortcut.id, shortcut.description)
                    .preferred_trigger(shortcut.preferred_trigger)
            })
            .collect();
        let response = portal
            .bind_shortcuts(&session, &shortcuts, None)
            .await
            .map_err(|error| format!("не удалось запросить BindShortcuts: {error}"))?
            .response();
        match response {
            Ok(response) => {
                let bound_shortcut_ids = response
                    .shortcuts()
                    .iter()
                    .map(|shortcut| shortcut.id())
                    .collect::<Vec<_>>();
                validate_bound_shortcuts(&bound_shortcut_ids)?;
            }
            Err(error) if is_missing_shortcuts_field(&error.to_string()) => {
                validate_bound_shortcuts(&[])?;
            }
            Err(error) => return Err(format!("BindShortcuts отклонён: {error}")),
        }
    }

    super::set_status(
        &app,
        super::Backend::Portal,
        "работает",
        "Сочетания настраиваются в параметрах рабочего окружения.".to_string(),
    );
    while let Some(event) = activated.next().await {
        match ShortcutAction::parse(event.shortcut_id()) {
            Some(action) => action.perform(&app),
            None => log::warn!(
                "XDG portal вернул неизвестное сочетание {:?}",
                event.shortcut_id()
            ),
        }
    }
    Ok(())
}

pub fn start_portal(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(app.clone()).await {
            log::warn!("XDG GlobalShortcuts недоступен: {error}");
            super::set_status(&app, super::Backend::Portal, "ошибка", error);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        is_missing_shortcuts_field, preferred_shortcuts, restore_decision,
        validate_bound_shortcuts, RestoreDecision,
    };

    #[test]
    fn preferred_triggers_match_application_shortcuts() {
        let shortcuts = preferred_shortcuts();
        let actual: Vec<_> = shortcuts
            .iter()
            .map(|shortcut| (shortcut.id, shortcut.preferred_trigger))
            .collect();
        assert_eq!(
            actual,
            vec![
                ("open", "CTRL+ALT+SPACE"),
                ("today", "CTRL+ALT+J"),
                ("new-task", "CTRL+ALT+N"),
            ]
        );
    }

    #[test]
    fn empty_saved_list_requires_binding() {
        assert_eq!(restore_decision(&[]), RestoreDecision::Bind);
    }

    #[test]
    fn unrelated_saved_shortcuts_require_binding() {
        assert_eq!(
            restore_decision(&["another-application-action"]),
            RestoreDecision::Bind
        );
    }

    #[test]
    fn partially_saved_shortcuts_require_binding() {
        assert_eq!(restore_decision(&["open", "today"]), RestoreDecision::Bind);
    }

    #[test]
    fn existing_saved_shortcuts_are_only_restored() {
        assert_eq!(
            restore_decision(&["open", "today", "new-task"]),
            RestoreDecision::Subscribe
        );
    }

    #[test]
    fn empty_bind_response_lists_all_unassigned_actions() {
        let error = validate_bound_shortcuts(&[]).unwrap_err();
        assert!(error.contains("open"), "unexpected error: {error}");
        assert!(error.contains("today"), "unexpected error: {error}");
        assert!(error.contains("new-task"), "unexpected error: {error}");
    }

    #[test]
    fn partial_bind_response_lists_only_missing_action() {
        let error = validate_bound_shortcuts(&["open", "today"]).unwrap_err();
        assert!(error.contains("new-task"), "unexpected error: {error}");
        assert!(!error.contains("open"), "unexpected error: {error}");
        assert!(!error.contains("today"), "unexpected error: {error}");
    }

    #[test]
    fn complete_bind_response_is_accepted() {
        assert!(validate_bound_shortcuts(&["open", "today", "new-task"]).is_ok());
    }

    #[test]
    fn only_missing_shortcuts_field_is_an_empty_response() {
        assert!(is_missing_shortcuts_field(
            "ZBus Error: missing field shortcuts"
        ));
        assert!(!is_missing_shortcuts_field(
            "ZBus Error: missing field session_handle"
        ));
        assert!(!is_missing_shortcuts_field("отклонено пользователем"));
    }
}
