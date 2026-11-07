pub mod ipc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutAction {
    Open,
    Today,
    NewTask,
}

impl ShortcutAction {
    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "open" => Some(Self::Open),
            "today" => Some(Self::Today),
            "new-task" => Some(Self::NewTask),
            _ => None,
        }
    }

    pub fn perform(self, app: &AppHandle) {
        crate::tray::show_main(app);
        let event = match self {
            Self::Open => None,
            Self::Today => Some("tray-today"),
            Self::NewTask => Some("tray-new-task"),
        };
        if let Some(event) = event {
            app.state::<crate::state::AppState>()
                .tray_events
                .lock()
                .deliver(event, |event| {
                    let _ = app.emit(event, ());
                });
        }
    }
}

pub fn parse_cli(args: &[String]) -> Result<Option<ShortcutAction>, String> {
    if args.is_empty() {
        return Ok(None);
    }
    if args.len() != 2 || args[0] != "--shortcut" {
        return Err("использование: logtask --shortcut open|today|new-task".to_string());
    }
    ShortcutAction::parse(&args[1]).map(Some).ok_or_else(|| {
        format!(
            "неизвестное действие {:?}; ожидается open, today или new-task",
            args[1]
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_cli, ShortcutAction};

    #[test]
    fn action_ids_parse_and_unknown_is_rejected() {
        assert_eq!(ShortcutAction::parse("open"), Some(ShortcutAction::Open));
        assert_eq!(ShortcutAction::parse("today"), Some(ShortcutAction::Today));
        assert_eq!(
            ShortcutAction::parse("new-task"),
            Some(ShortcutAction::NewTask)
        );
        assert_eq!(ShortcutAction::parse("unknown"), None);
    }

    #[test]
    fn cli_without_shortcut_starts_gui() {
        assert_eq!(parse_cli(&[]).unwrap(), None);
    }

    #[test]
    fn cli_parses_all_shortcut_actions() {
        for (id, action) in [
            ("open", ShortcutAction::Open),
            ("today", ShortcutAction::Today),
            ("new-task", ShortcutAction::NewTask),
        ] {
            let args = vec!["--shortcut".to_string(), id.to_string()];
            assert_eq!(parse_cli(&args).unwrap(), Some(action));
        }
    }

    #[test]
    fn cli_rejects_unknown_missing_and_extra_arguments() {
        for args in [
            vec!["--shortcut".to_string()],
            vec!["--shortcut".to_string(), "unknown".to_string()],
            vec![
                "--shortcut".to_string(),
                "open".to_string(),
                "extra".to_string(),
            ],
            vec!["--unknown".to_string()],
        ] {
            assert!(parse_cli(&args).is_err(), "args: {args:?}");
        }
    }
}
