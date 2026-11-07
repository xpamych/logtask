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
            preferred_trigger: "CTRL+SHIFT+T",
        },
    ]
}

fn restore_decision(saved_shortcut_count: usize) -> RestoreDecision {
    if saved_shortcut_count == 0 {
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
    if restore_decision(saved.shortcuts().len()) == RestoreDecision::Bind {
        let shortcuts: Vec<_> = preferred_shortcuts()
            .into_iter()
            .map(|shortcut| {
                NewShortcut::new(shortcut.id, shortcut.description)
                    .preferred_trigger(shortcut.preferred_trigger)
            })
            .collect();
        portal
            .bind_shortcuts(&session, &shortcuts, None)
            .await
            .map_err(|error| format!("не удалось запросить BindShortcuts: {error}"))?
            .response()
            .map_err(|error| format!("BindShortcuts отклонён: {error}"))?;
    }

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
        if let Err(error) = run(app).await {
            log::warn!("XDG GlobalShortcuts недоступен: {error}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{preferred_shortcuts, restore_decision, RestoreDecision};

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
                ("new-task", "CTRL+SHIFT+T"),
            ]
        );
    }

    #[test]
    fn empty_saved_list_requires_binding() {
        assert_eq!(restore_decision(0), RestoreDecision::Bind);
    }

    #[test]
    fn existing_saved_shortcuts_are_only_restored() {
        assert_eq!(restore_decision(3), RestoreDecision::Subscribe);
    }
}
