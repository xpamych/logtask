pub mod ipc;
pub mod niri;
pub mod portal;
pub mod sway;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BackendStatus {
    pub backend: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct GlobalShortcutsState {
    status: parking_lot::RwLock<Option<BackendStatus>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Portal,
    Sway,
    Niri,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEnvironment {
    pub session_type: Option<String>,
    pub wayland_display: Option<String>,
    pub current_desktop: Option<String>,
}

impl DesktopEnvironment {
    fn from_env() -> Self {
        Self {
            session_type: std::env::var("XDG_SESSION_TYPE").ok(),
            wayland_display: std::env::var("WAYLAND_DISPLAY").ok(),
            current_desktop: std::env::var("XDG_CURRENT_DESKTOP").ok(),
        }
    }
}

pub fn detect_backend(environment: &DesktopEnvironment) -> Backend {
    let wayland = environment
        .session_type
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
        || environment.wayland_display.is_some();
    if !wayland {
        return Backend::Unsupported;
    }
    let desktops = environment.current_desktop.as_deref().unwrap_or_default();
    let has = |name: &str| {
        desktops
            .split(':')
            .any(|desktop| desktop.eq_ignore_ascii_case(name))
    };
    if has("sway") {
        Backend::Sway
    } else if has("niri") {
        Backend::Niri
    } else if has("KDE") || has("GNOME") || has("Hyprland") {
        Backend::Portal
    } else {
        Backend::Unsupported
    }
}

fn backend_name(backend: Backend) -> &'static str {
    match backend {
        Backend::Portal => "XDG GlobalShortcuts portal",
        Backend::Sway => "Sway",
        Backend::Niri => "Niri",
        Backend::Unsupported => "Нет",
    }
}

pub fn set_status(app: &AppHandle, backend: Backend, status: &str, message: String) {
    if let Some(state) = app.try_state::<GlobalShortcutsState>() {
        *state.status.write() = Some(BackendStatus {
            backend: backend_name(backend).to_string(),
            status: status.to_string(),
            message,
        });
    }
}

pub fn status(app: &AppHandle) -> BackendStatus {
    app.state::<GlobalShortcutsState>()
        .status
        .read()
        .clone()
        .unwrap_or_else(|| BackendStatus {
            backend: "Не определён".to_string(),
            status: "запуск".to_string(),
            message: String::new(),
        })
}

pub fn start_backend(app: AppHandle) {
    let backend = detect_backend(&DesktopEnvironment::from_env());
    set_status(&app, backend, "запуск", String::new());
    std::thread::spawn(move || match backend {
        Backend::Portal => {
            if let Err(error) = portal::start_portal(app.clone()) {
                log::warn!("XDG GlobalShortcuts недоступен: {error}");
                set_status(&app, backend, "ошибка", error);
            }
        }
        Backend::Sway => {
            let result = sway::start_sway();
            let mut messages = Vec::new();
            if !result.conflicts.is_empty() {
                messages.push(format!(
                    "Занятые сочетания: {}.",
                    result.conflicts.join(", ")
                ));
            }
            if let Some(error) = result.error {
                messages.push(error);
            }
            let status = if result.active && messages.is_empty() {
                "работает"
            } else if result.active {
                "частично"
            } else {
                "ошибка"
            };
            set_status(&app, backend, status, messages.join(" "));
        }
        Backend::Niri => set_status(
            &app,
            backend,
            "требуется настройка",
            format!(
                "Создайте отдельный конфиг кнопкой ниже и добавьте `{}` в config.kdl.",
                niri::niri_include()
            ),
        ),
        Backend::Unsupported => set_status(
            &app,
            backend,
            "недоступно",
            "Глобальные сочетания поддерживаются в Wayland: KDE, GNOME, Hyprland, Sway и Niri."
                .to_string(),
        ),
    });
}

fn exit_cleanup(backend: Backend, stop_sway: impl FnOnce()) {
    if backend == Backend::Sway {
        stop_sway();
    }
}

pub fn stop_backend() {
    exit_cleanup(
        detect_backend(&DesktopEnvironment::from_env()),
        sway::stop_sway,
    );
}

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
    use super::{
        detect_backend, exit_cleanup, parse_cli, Backend, DesktopEnvironment, ShortcutAction,
    };

    fn environment(session: &str, desktop: &str) -> DesktopEnvironment {
        DesktopEnvironment {
            session_type: Some(session.to_string()),
            wayland_display: (session == "wayland").then(|| "wayland-0".to_string()),
            current_desktop: Some(desktop.to_string()),
        }
    }

    #[test]
    fn detects_supported_wayland_desktops() {
        for (desktop, backend) in [
            ("KDE", Backend::Portal),
            ("GNOME", Backend::Portal),
            ("Hyprland", Backend::Portal),
            ("sway", Backend::Sway),
            ("niri", Backend::Niri),
        ] {
            assert_eq!(
                detect_backend(&environment("wayland", desktop)),
                backend,
                "desktop: {desktop}"
            );
        }
    }

    #[test]
    fn detects_desktop_in_colon_separated_list_case_insensitively() {
        assert_eq!(
            detect_backend(&environment("wayland", "ubuntu:GNOME")),
            Backend::Portal
        );
        assert_eq!(
            detect_backend(&environment("wayland", "unknown:SWAY")),
            Backend::Sway
        );
    }

    #[test]
    fn unsupported_desktop_has_no_backend() {
        assert_eq!(
            detect_backend(&environment("wayland", "XFCE")),
            Backend::Unsupported
        );
    }

    #[test]
    fn supported_desktop_without_wayland_has_no_backend() {
        assert_eq!(
            detect_backend(&environment("x11", "KDE")),
            Backend::Unsupported
        );
        let mut environment = environment("wayland", "KDE");
        environment.session_type = None;
        assert_eq!(detect_backend(&environment), Backend::Portal);
        environment.wayland_display = None;
        assert_eq!(detect_backend(&environment), Backend::Unsupported);
    }

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
    fn exit_cleanup_runs_only_for_sway() {
        for (backend, expected_calls) in [
            (Backend::Sway, 1),
            (Backend::Portal, 0),
            (Backend::Niri, 0),
            (Backend::Unsupported, 0),
        ] {
            let mut calls = 0;
            exit_cleanup(backend, || calls += 1);
            assert_eq!(calls, expected_calls, "backend: {backend:?}");
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
