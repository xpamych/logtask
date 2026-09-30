use serde::Serialize;

use crate::core::index::IndexStats;
use crate::core::model::{Block, Graph, PageKind, Status};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct GraphSummary {
    pub pages: usize,
    pub journals: usize,
    pub blocks: usize,
    pub tasks: usize,
    pub backlinks: usize,
    pub root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockDto {
    pub uuid: String,
    pub status: Option<String>,
    pub status_label: Option<String>,
    pub priority: Option<String>,
    pub content: String,
    pub indent: u8,
    pub task: bool,
    pub urgency: Option<String>,
    pub importance: Option<String>,
    pub links: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageDto {
    pub name: String,
    pub kind: String,
    pub blocks: Vec<BlockDto>,
}

impl From<&Block> for BlockDto {
    fn from(b: &Block) -> Self {
        BlockDto {
            uuid: b.id.map(|u| u.to_string()).unwrap_or_default(),
            status: b.status.map(|s| s.to_marker().to_string()),
            status_label: b.status.map(|s| s.label().to_string()),
            priority: b.priority.map(|p| format!("[#{p:?}]").replace('"', "")),
            content: b.content.clone(),
            indent: b.indent,
            task: b.is_task(),
            urgency: b.urgency.map(|l| format!("{l:?}").to_lowercase()),
            importance: b.importance.map(|l| format!("{l:?}").to_lowercase()),
            links: b
                .links
                .iter()
                .map(|l| match l {
                    crate::core::model::LinkTarget::Page(n)
                    | crate::core::model::LinkTarget::Tag(n) => n.clone(),
                    crate::core::model::LinkTarget::Block(n) => format!("(({n}))"),
                })
                .collect(),
        }
    }
}

/// Индексирует граф и возвращает сводку. Если path не задан — берёт
/// граф по умолчанию из настроек (пока — ~/Документы/Logseq)
#[tauri::command]
pub fn graph_load(
    path: Option<String>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<GraphSummary, String> {
    let root = path.unwrap_or_else(default_graph_path);
    if !std::path::Path::new(&root).is_dir() {
        return Err(format!("граф не найден: {root}"));
    }

    let mut graph = Graph::default();
    let stats: IndexStats = graph
        .index_dir(std::path::Path::new(&root))
        .map_err(|e| format!("ошибка индексации: {e}"))?;

    log::info!(
        "граф загружен: {root}: {} журналов, {} страниц, {} блоков, {} задач, {} обратных ссылок",
        stats.journals,
        stats.pages,
        stats.blocks,
        stats.tasks,
        graph.backlinks.len()
    );

    let summary = GraphSummary {
        pages: stats.pages,
        journals: stats.journals,
        blocks: stats.blocks,
        tasks: stats.tasks,
        backlinks: graph.backlinks.len(),
        root: Some(root.clone()),
    };
    *state.graph.write() = Some(graph);
    *state.root.write() = Some(std::path::PathBuf::from(root));

    // (пере)запускаем наблюдатель за файлами — только если ещё не активен
    if state.watcher.read().is_none() {
        if let Err(e) = crate::watcher::spawn_for_current(&app) {
            log::warn!("watcher не запущен: {e}");
        }
    }
    Ok(summary)
}

/// Сводка по уже загруженному графу (без переиндексации и без старта
/// watcher'а) — для обновления UI по событию graph-changed
#[tauri::command]
pub fn graph_summary(state: tauri::State<'_, AppState>) -> Result<GraphSummary, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    Ok(GraphSummary {
        pages: graph
            .pages
            .values()
            .filter(|p| p.kind == PageKind::Page)
            .count(),
        journals: graph
            .pages
            .values()
            .filter(|p| p.kind == PageKind::Journal)
            .count(),
        blocks: graph.blocks.len(),
        tasks: graph.all_tasks().len(),
        backlinks: graph.backlinks.len(),
        root: state.root.read().as_ref().map(|p| p.display().to_string()),
    })
}

/// Список журналов (имена), последние n
#[tauri::command]
pub fn journal_list(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    Ok(sorted_journals(graph))
}

/// N журналов, идущих перед указанной датой (для ленты при скролле вниз)
#[tauri::command]
pub fn journal_prev(
    before: String,
    n: usize,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let journals = sorted_journals(graph);
    let pos = journals
        .iter()
        .position(|j| *j == before)
        .unwrap_or(journals.len());
    let start = pos.saturating_sub(n);
    Ok(journals[start..pos].to_vec())
}

/// Возвращает страницу (журнал или обычную) с блоками
#[tauri::command]
pub fn page_get(name: String, state: tauri::State<'_, AppState>) -> Result<PageDto, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    page_get_impl(graph, &name)
}

/// Резолвит [[ссылку]] / #тег / путь — возвращает страницу-цель если существует
#[tauri::command]
pub fn follow_link(
    target: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<PageDto>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    Ok(graph
        .pages
        .get(&target)
        .and_then(|_| page_get_impl(graph, &target).ok()))
}

/// Поиск по блокам и страницам
#[tauri::command]
pub fn search(query: String, state: tauri::State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let mut pages: Vec<SearchHit> = graph
        .pages
        .keys()
        .filter(|n| n.to_lowercase().contains(&query.to_lowercase()))
        .map(|n| SearchHit {
            kind: "page".into(),
            page: n.clone(),
            text: n.clone(),
        })
        .take(20)
        .collect();
    let mut blocks: Vec<SearchHit> = graph
        .search(query, 30)
        .into_iter()
        .map(|(id, text)| SearchHit {
            kind: "block".into(),
            page: graph.page_of_block(&id),
            text,
        })
        .collect();
    pages.append(&mut blocks);
    Ok(pages)
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub kind: String,
    pub page: String,
    pub text: String,
}

fn page_get_impl(graph: &Graph, name: &str) -> Result<PageDto, String> {
    let page = graph
        .pages
        .get(name)
        .ok_or_else(|| format!("страница не найдена: {name}"))?;
    let blocks: Vec<BlockDto> = page
        .order
        .iter()
        .filter_map(|id| graph.blocks.get(id))
        .map(BlockDto::from)
        .collect();
    Ok(PageDto {
        name: page.name.clone(),
        kind: match page.kind {
            PageKind::Journal => "journal".into(),
            PageKind::Page => "page".into(),
        },
        blocks,
    })
}

/// Имена журналов, отсортированные от новых к старым
fn sorted_journals(graph: &Graph) -> Vec<String> {
    let mut journals: Vec<String> = graph
        .pages
        .iter()
        .filter(|(_, p)| p.kind == PageKind::Journal)
        .map(|(n, _)| n.clone())
        .collect();
    journals.sort();
    journals.reverse();
    journals
}

/// Обратные ссылки на страницу
#[tauri::command]
pub fn backlinks_get(
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<(String, String)>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let links = graph.backlinks_of(&name);
    Ok(links
        .into_iter()
        .filter_map(|(id, page)| {
            graph.blocks.get(&id).map(|b| {
                (
                    page,
                    b.content.trim_end().chars().take(120).collect::<String>(),
                )
            })
        })
        .collect())
}

pub fn default_graph_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let docs = format!("{home}/Документы/Logseq");
    if std::path::Path::new(&docs).is_dir() {
        return docs;
    }
    format!("{home}/Documents/Logseq")
}

/// Список всех страниц (для сайдбара), отсортированный
#[tauri::command]
pub fn page_list(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let mut names: Vec<String> = graph
        .pages
        .keys()
        .filter(|n| !is_journal_name(n))
        .cloned()
        .collect();
    names.sort();
    Ok(names)
}

fn is_journal_name(name: &str) -> bool {
    let mut parts = name.split('_');
    let (y, m, d) = match (parts.next(), parts.next(), parts.next()) {
        (Some(y), Some(m), Some(d)) => (y, m, d),
        _ => return false,
    };
    if parts.next().is_some() {
        return false;
    }
    y.len() == 4
        && y.parse::<u16>().is_ok()
        && m.len() == 2
        && d.len() == 2
        && m.parse::<u8>()
            .map(|m| (1..=12).contains(&m))
            .unwrap_or(false)
        && d.parse::<u8>()
            .map(|d| (1..=31).contains(&d))
            .unwrap_or(false)
}

/// Задача для UI: блок + страница-источник
#[derive(Debug, Clone, Serialize)]
pub struct TaskDto {
    pub uuid: String,
    pub page: String,
    pub content: String,
    pub status: Option<String>,
    pub status_label: Option<String>,
    pub priority: Option<String>,
    pub urgency: Option<String>,
    pub importance: Option<String>,
    pub deadline: Option<String>,
    pub scheduled: Option<String>,
    pub tags: Vec<String>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskColumn {
    pub marker: String,
    pub label: String,
    pub tasks: Vec<TaskDto>,
}

fn task_dto(graph: &Graph, id: uuid::Uuid, block: &Block) -> TaskDto {
    let tags: Vec<String> = block
        .links
        .iter()
        .filter_map(|l| match l {
            crate::core::model::LinkTarget::Tag(t) => Some(t.clone()),
            _ => None,
        })
        .collect();
    TaskDto {
        uuid: id.to_string(),
        page: graph.page_of_block(&id),
        content: block.content.trim().to_string(),
        status: block.status.map(|s| s.to_marker().to_string()),
        status_label: block.status.map(|s| s.label().to_string()),
        priority: block.priority.map(|p| format!("[#{p:?}]").replace('"', "")),
        urgency: block.urgency.map(|l| format!("{l:?}").to_lowercase()),
        importance: block.importance.map(|l| format!("{l:?}").to_lowercase()),
        deadline: block.props.get("deadline").cloned(),
        scheduled: block.props.get("scheduled").cloned(),
        tags,
        done: block.status.map(|s| s.is_done()).unwrap_or(false),
    }
}

/// Канбан: все задачи, сгруппированные по 6 статусам
#[tauri::command]
pub fn kanban(state: tauri::State<'_, AppState>) -> Result<Vec<TaskColumn>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;

    let mut columns: Vec<(String, String, Vec<TaskDto>)> = vec![
        ("LATER".into(), Status::Later.label().to_string(), vec![]),
        ("TODO".into(), Status::Todo.label().to_string(), vec![]),
        ("DOING".into(), Status::Doing.label().to_string(), vec![]),
        ("REVIEW".into(), Status::Review.label().to_string(), vec![]),
        ("DONE".into(), Status::Done.label().to_string(), vec![]),
        (
            "CANCELED".into(),
            Status::Canceled.label().to_string(),
            vec![],
        ),
    ];

    let by_marker: std::collections::HashMap<&str, usize> = [
        ("LATER", 0),
        ("TODO", 1),
        ("DOING", 2),
        ("REVIEW", 3),
        ("DONE", 4),
        ("CANCELED", 5),
    ]
    .into_iter()
    .collect();

    for (id, block) in graph.all_tasks() {
        let Some(status) = block.status else {
            continue;
        };
        let marker = status.to_marker();
        if let Some(&idx) = by_marker.get(marker) {
            columns[idx].2.push(task_dto(graph, id, block));
        }
    }

    // внутри колонки — по приоритету, потом по странице
    for (_, _, tasks) in columns.iter_mut() {
        tasks.sort_by(|a, b| {
            a.priority
                .clone()
                .unwrap_or("Z".into())
                .cmp(&b.priority.clone().unwrap_or("Z".into()))
                .then_with(|| a.page.cmp(&b.page))
        });
    }

    Ok(columns
        .into_iter()
        .map(|(marker, label, tasks)| TaskColumn {
            marker,
            label,
            tasks,
        })
        .collect())
}

/// Задачи по фильтру (для saved-запросов)
#[tauri::command]
pub fn tasks_by_filter(
    filter: crate::core::query::TaskFilter,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TaskDto>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let entries = graph.filter_tasks(&filter);
    Ok(entries
        .into_iter()
        .map(|(id, block)| task_dto(graph, id, block))
        .collect())
}

/// Сохранённые запросы графа (читает/пишет <граф>/.logtask/queries.json)
#[tauri::command]
pub fn queries_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::core::query::SavedQuery>, String> {
    let root = state.root.read().clone();
    let Some(root) = root else {
        return Ok(default_queries());
    };
    let path = root.join(".logtask").join("queries.json");
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| format!("queries.json: {e}")),
            Err(_) => Ok(default_queries()),
        }
    } else {
        Ok(default_queries())
    }
}

#[tauri::command]
pub fn queries_save(
    queries: Vec<crate::core::query::SavedQuery>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let path = dir.join("queries.json");
    let text = serde_json::to_string_pretty(&queries).map_err(|e| format!("{e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("{e}"))
}

/// Импорт `:default-queries` из logseq/config.edn (разовый при первом старте):
/// переносит «Сейчас / Работа / PPDB / Gitea / Остальные дела»
#[tauri::command]
pub fn import_logseq_queries(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let config = root.join("logseq").join("config.edn");
    if !config.exists() {
        return Err("logseq/config.edn не найден".into());
    }
    let text = std::fs::read_to_string(&config).map_err(|e| format!("{e}"))?;
    let imported = crate::config_edn::parse_default_queries(&text);
    if imported.is_empty() {
        return Ok(0);
    }
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{e}"))?;
    let path = dir.join("queries.json");
    let text = serde_json::to_string_pretty(&imported).map_err(|e| format!("{e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("{e}"))?;
    Ok(imported.len())
}

/// Меняет статус задачи (drag&drop в канбане). Перезаписывает .md файл.
#[tauri::command]
pub async fn task_set_status(
    uuid: String,
    marker: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;
    let status = Status::from_marker(&marker).ok_or(format!("неизвестный маркер: {marker}"))?;

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .set_block_status(&id, status, &root)
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };

    // переиндексируем и оповестим UI
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Запросы по умолчанию (пока config.edn не импортирован)
fn default_queries() -> Vec<crate::core::query::SavedQuery> {
    use crate::core::query::{SavedQuery, TaskFilter};

    vec![SavedQuery {
        title: "Открытые задачи".into(),
        filter: TaskFilter {
            open: true,
            ..Default::default()
        },
        sort: vec![],
        collapsed: false,
    }]
}

#[tauri::command]
pub fn ping() -> &'static str {
    "logtask-core: ok"
}
