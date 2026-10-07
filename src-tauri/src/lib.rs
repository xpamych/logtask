mod commands;
pub mod config_edn;
pub mod core;
mod recent;
mod settings;
mod state;
pub mod sync;
mod watcher;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![
            commands::graph_load,
            commands::graph_summary,
            commands::graph_close,
            commands::journal_list,
            commands::journal_prev,
            commands::page_get,
            commands::page_list,
            commands::page_rename,
            commands::page_reveal_in_files,
            commands::page_delete,
            commands::follow_link,
            commands::search,
            commands::backlinks_get,
            commands::kanban,
            commands::tasks_by_filter,
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
        ])
        .setup(|app| {
            let main = app.get_webview_window("main").expect("главное окно");
            let _ = main.show();

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
        .run(tauri::generate_context!())
        .expect("ошибка запуска Logtask");
}
