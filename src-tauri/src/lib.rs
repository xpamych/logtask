mod commands;
pub mod config_edn;
pub mod core;
mod recent;
mod settings;
mod state;
mod watcher;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            commands::block_create,
            commands::clock_start,
            commands::clock_stop,
            commands::settings_get,
            commands::settings_save,
            commands::task_set_priority,
            commands::block_set_prop,
            commands::recent_graphs,
            commands::recent_remove,
            commands::pick_graph_dir,
            commands::ping,
        ])
        .setup(|app| {
            let main = app.get_webview_window("main").expect("главное окно");
            let _ = main.show();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ошибка запуска Logtask");
}
