mod commands;
pub mod config_edn;
pub mod core;
mod state;
mod watcher;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::graph_load,
            commands::graph_summary,
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
