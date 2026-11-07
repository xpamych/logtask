use std::path::Path;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct TrayEvents {
    ready: bool,
    pending: Vec<&'static str>,
}

impl TrayEvents {
    fn deliver(&mut self, event: &'static str, emit: impl FnOnce(&'static str)) {
        if self.ready {
            emit(event);
        } else {
            self.pending.push(event);
        }
    }

    fn mark_ready(&mut self) -> Vec<&'static str> {
        self.ready = true;
        std::mem::take(&mut self.pending)
    }
}

#[tauri::command]
pub fn ready(state: tauri::State<'_, crate::state::AppState>) -> Vec<&'static str> {
    state.tray_events.lock().mark_ready()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayAction {
    Open,
    Today,
    NewTask,
    Quit,
}

impl TrayAction {
    fn from_menu_id(id: &str) -> Option<Self> {
        match id {
            "open" => Some(Self::Open),
            "today" => Some(Self::Today),
            "new-task" => Some(Self::NewTask),
            "quit" => Some(Self::Quit),
            _ => None,
        }
    }

    fn perform(self, app: &AppHandle) {
        if self == Self::Quit {
            app.exit(0);
            return;
        }
        show_main(app);
        let event = match self {
            Self::Open => None,
            Self::Today => Some("tray-today"),
            Self::NewTask => Some("tray-new-task"),
            Self::Quit => return,
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

fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn should_hide_on_close(root: Option<&Path>, tray_available: bool) -> bool {
    tray_available
        && root
            .and_then(|root| crate::settings::load(root).ok())
            .map(|settings| settings.close_to_tray)
            .unwrap_or(true)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть Logtask", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "Сегодняшний журнал", true, None::<&str>)?;
    let new_task = MenuItem::with_id(app, "new-task", "Новая задача", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &today, &new_task, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(action) = TrayAction::from_menu_id(event.id().as_ref()) {
                action.perform(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                TrayAction::Open.perform(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    app.manage(tray.build(app)?);
    app.state::<crate::state::AppState>()
        .tray_available
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_to_actions() {
        assert_eq!(TrayAction::from_menu_id("open"), Some(TrayAction::Open));
        assert_eq!(TrayAction::from_menu_id("today"), Some(TrayAction::Today));
        assert_eq!(
            TrayAction::from_menu_id("new-task"),
            Some(TrayAction::NewTask)
        );
        assert_eq!(TrayAction::from_menu_id("quit"), Some(TrayAction::Quit));
        assert_eq!(TrayAction::from_menu_id("unknown"), None);
    }

    #[test]
    fn close_uses_default_without_graph() {
        assert!(should_hide_on_close(None, true));
    }

    #[test]
    fn close_does_not_hide_without_tray() {
        assert!(!should_hide_on_close(None, false));
    }

    #[test]
    fn events_wait_for_frontend_and_then_go_directly() {
        let mut events = TrayEvents::default();
        let mut emitted = Vec::new();
        events.deliver("tray-today", |event| emitted.push(event));
        assert!(emitted.is_empty());
        assert_eq!(events.mark_ready(), vec!["tray-today"]);

        events.deliver("tray-new-task", |event| emitted.push(event));
        assert_eq!(emitted, vec!["tray-new-task"]);
        assert!(events.mark_ready().is_empty());
    }

    #[test]
    fn close_reads_current_setting() {
        let dir = std::env::temp_dir().join("logtask_tray_close_test");
        let _ = std::fs::remove_dir_all(&dir);
        let settings = crate::settings::Settings {
            close_to_tray: false,
            ..Default::default()
        };
        crate::settings::save(&dir, &settings).unwrap();
        assert!(!should_hide_on_close(Some(&dir), true));

        let settings = crate::settings::Settings {
            close_to_tray: true,
            ..Default::default()
        };
        crate::settings::save(&dir, &settings).unwrap();
        assert!(should_hide_on_close(Some(&dir), true));
    }
}
