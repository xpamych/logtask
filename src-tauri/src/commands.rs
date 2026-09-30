use serde::Serialize;

#[derive(Serialize)]
pub struct GraphSummary {
    pub pages: usize,
    pub journals: usize,
}

/// stub:.real подсчёт появится в Фазе 1 (индекс графа)
#[tauri::command]
pub fn graph_summary() -> GraphSummary {
    GraphSummary {
        pages: 0,
        journals: 0,
    }
}

#[tauri::command]
pub fn ping() -> &'static str {
    "logtask-core: ok"
}
