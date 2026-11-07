mod commands;
pub mod config_edn;
pub mod core;
pub mod graph_layout;
mod recent;
mod settings;
pub mod shortcuts;
mod state;
pub mod sync;
mod tray;
mod watcher;

use state::AppState;
use tauri::Manager;

fn show_startup_error(message: &str) {
    eprintln!("{message}");
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        if gtk::init().is_ok() {
            let dialog = gtk::MessageDialog::new(
                None::<&gtk::Window>,
                gtk::DialogFlags::MODAL,
                gtk::MessageType::Error,
                gtk::ButtonsType::Close,
                message,
            );
            dialog.set_title("Logtask");
            dialog.run();
            dialog.close();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    match shortcuts::ipc::ensure_not_running() {
        Err(error) if error.is_already_running() => {
            show_startup_error(&error.to_string());
            return;
        }
        Err(error) => eprintln!("локальный IPC глобальных сочетаний недоступен: {error}"),
        Ok(()) => {}
    }

    let cleanup_backend = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cleanup_backend_setup = std::sync::Arc::clone(&cleanup_backend);
    let cleanup_backend_exit = std::sync::Arc::clone(&cleanup_backend);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // запоминаем и размер, и положение (на Wayland положение
                // восстановится только если позволит композитор)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: std::path::PathBuf::from(
                            std::env::var("HOME").unwrap_or_else(|_| ".".to_string()),
                        )
                        .join(".config/logtask/logs"),
                        file_name: Some("logtask".to_string()),
                    }),
                ])
                .build(),
        )
        .manage(AppState::default())
        .manage(shortcuts::GlobalShortcutsState::default())
        .invoke_handler(tauri::generate_handler![
            commands::graph_load,
            commands::graph_summary,
            commands::graph_close,
            commands::visual_graph_snapshot,
            commands::visual_graph_local,
            commands::visual_graph_path,
            commands::visual_graph_layout_get,
            commands::visual_graph_layout_save,
            commands::asset_open,
            commands::asset_reveal,
            commands::journal_list,
            commands::journal_prev,
            commands::page_get,
            commands::page_list,
            commands::page_rename,
            commands::page_reveal_in_files,
            commands::page_delete,
            commands::page_create,
            commands::follow_link,
            commands::search,
            commands::backlinks_get,
            commands::kanban,
            commands::tasks_by_query,
            commands::queries_list,
            commands::queries_save,
            commands::import_logseq_queries,
            commands::task_set_status,
            commands::matrix,
            commands::task_set_quadrant,
            commands::block_update_text,
            commands::block_delete,
            commands::block_merge_up,
            commands::block_merge_down,
            commands::block_indent,
            commands::block_outdent,
            commands::block_split,
            commands::log_frontend,
            commands::block_create,
            commands::clock_start,
            commands::clock_stop,
            commands::settings_get,
            commands::settings_save,
            commands::task_set_priority,
            commands::block_set_prop,
            commands::recent_graphs,
            commands::recent_remove,
            commands::asset_data_url,
            commands::asset_save,
            commands::clipboard_asset_save,
            commands::favicon_data_url,
            commands::web_title,
            commands::open_external,
            commands::pick_graph_dir,
            commands::graph_create,
            commands::graph_needs_scaffold,
            commands::integrations_states,
            commands::integrations_set_secret,
            commands::integrations_test,
            commands::integrations_sync,
            commands::ping,
            commands::global_shortcuts_status,
            commands::niri_config_write,
            tray::ready,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let root = state.root.read().clone();
                let available = state
                    .tray_available
                    .load(std::sync::atomic::Ordering::Relaxed);
                if tray::should_hide_on_close(root.as_deref(), available) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            let main = app.get_webview_window("main").expect("главное окно");
            if let Err(error) = shortcuts::ipc::listen(app.handle()) {
                if error.is_already_running() {
                    show_startup_error(&error.to_string());
                    app.handle().exit(1);
                    return Ok(());
                }
                log::warn!("локальный IPC глобальных сочетаний недоступен: {error}");
            }
            let _ = main.show();
            if let Err(e) = tray::init(app.handle()) {
                log::warn!("системный трей недоступен: {e}");
            }
            cleanup_backend_setup.store(true, std::sync::atomic::Ordering::Release);
            shortcuts::start_backend(app.handle().clone());

            // WebKitGTK не диспатчит Shift+Tab в DOM (выполняет backtab-навигацию
            // нативно) — перехватываем на уровне виджета и шлём событие во фронт
            #[cfg(target_os = "linux")]
            {
                use gtk::prelude::*;
                use tauri::Emitter;
                let main_for_keys = main.clone();
                main.with_webview(move |platform| {
                    let wv = platform.inner();
                    wv.connect_key_press_event(move |_, ev| {
                        let kv = ev.keyval();
                        // Shift+Tab в GDK — отдельный keysym ISO_Left_Tab, а не Tab!
                        let backtab = kv == gtk::gdk::keys::constants::ISO_Left_Tab
                            || (kv == gtk::gdk::keys::constants::Tab
                                && ev.state().contains(gtk::gdk::ModifierType::SHIFT_MASK));
                        if backtab {
                            let _ = main_for_keys.emit("editor-shift-tab", ());
                            return gtk::glib::Propagation::Stop;
                        }
                        gtk::glib::Propagation::Proceed
                    });
                })?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ошибка запуска Logtask")
        .run(move |_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                shortcuts::stop_backend(
                    cleanup_backend_exit.load(std::sync::atomic::Ordering::Acquire),
                );
            }
        });
}
