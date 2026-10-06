use serde::Serialize;

use crate::core::index::IndexStats;
use crate::core::model::{Block, Graph, PageKind, Status};
use crate::state::AppState;

/// Отмечает, что запись в файлы сделана нами — watcher пропустит эхо
pub(crate) fn mark_self_write(state: &AppState) {
    *state.last_self_write.lock() = Some(std::time::Instant::now());
}

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
#[serde(rename_all = "camelCase")]
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
    pub clock_running: bool,
    pub clock_total: Option<String>,
    pub deadline: Option<String>,
    pub scheduled: Option<String>,
    /// строки-продолжения блока без маркера (параграфы, код, списки) —
    /// для отображения; в файле живут в raw.trailing
    pub extra: Vec<String>,
    /// полный редактируемый текст блока (как в Logseq): [#X] + контент +
    /// все строки-продолжения без базового отступа
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageDto {
    pub name: String,
    pub kind: String,
    pub blocks: Vec<BlockDto>,
    /// преамбула страницы без page-props (заголовки/параграфы до первого блока)
    pub preamble: Vec<String>,
}

impl From<&Block> for BlockDto {
    fn from(b: &Block) -> Self {
        // суммарная длительность по всем CLOCK
        let clock_total = total_clock_duration(b);
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
            clock_running: b.clock_running(),
            clock_total,
            deadline: b.props.get("deadline").cloned(),
            scheduled: b.props.get("scheduled").cloned(),
            extra: b
                .raw
                .trailing
                .iter()
                .filter_map(|t| match t {
                    crate::core::model::Trailing::Raw { text, .. } => Some(text.clone()),
                    _ => None,
                })
                .collect(),
            source: b.edit_source(),
        }
    }
}

/// Суммарная длительность CLOCK блока в формате Logseq ("118:30:48")
fn total_clock_duration(b: &Block) -> Option<String> {
    let mut total = 0i64;
    let mut any = false;
    for c in &b.logbook {
        if let Some(end) = &c.end {
            if let Some(dur) = clock_seconds(&c.start, end) {
                total += dur;
                any = true;
            }
        }
    }
    if !any {
        return None;
    }
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    Some(format!("{h}:{m:02}:{s:02}"))
}

/// Секунды между двумя Org timestamp
fn clock_seconds(start: &str, end: &str) -> Option<i64> {
    let a = org_time_to_seconds(start)?;
    let b = org_time_to_seconds(end)?;
    (b - a).into()
}

fn org_time_to_seconds(s: &str) -> Option<i64> {
    use crate::core::model::ymd_to_days;
    let s = s.trim();
    let date = s.get(..10)?;
    let y: i64 = date.get(..4)?.parse().ok()?;
    let mo: u32 = date.get(5..7)?.parse().ok()?;
    let d: u32 = date.get(8..10)?.parse().ok()?;
    let rest = s[10..].trim();
    let time = rest.split_whitespace().nth(1).unwrap_or("00:00:00");
    let mut tp = time.split(':');
    let h: i64 = tp.next()?.parse().ok()?;
    let m: i64 = tp.next().unwrap_or("0").parse().ok()?;
    let sec: i64 = tp.next().unwrap_or("0").parse().ok()?;
    Some(ymd_to_days(y, mo, d) * 86400 + h * 3600 + m * 60 + sec)
}

/// Индексирует граф и возвращает сводку. Если path не задан — берёт
/// LOGTASK_GRAPH или последний недавний граф; иначе просит выбрать
#[tauri::command]
pub async fn graph_load(
    path: Option<String>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<GraphSummary, String> {
    let Some(root) = path.or_else(default_graph_path) else {
        return Err("граф не выбран — откройте его через диалог выбора графа".into());
    };
    if !std::path::Path::new(&root).is_dir() {
        return Err(format!("граф не найден: {root}"));
    }

    let mut graph = Graph::default();
    let stats: IndexStats = graph
        .index_dir(std::path::Path::new(&root))
        .map_err(|e| format!("ошибка индексации: {e}"))?;

    // создаём сегодняшнюю страницу журнала, если её ещё нет
    ensure_today_journal(std::path::Path::new(&root), &mut graph);

    log::info!(
        "граф загружен: {root}: {} журналов, {} страниц, {} блоков, {} задач, {} обратных ссылок",
        stats.journals,
        stats.pages,
        stats.blocks,
        stats.tasks,
        graph.backlinks.len()
    );

    // запоминаем граф в недавних
    crate::recent::touch(&root);

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

    // перезапускаем наблюдатель под новый граф: старый дропаем
    // (поток коалесцирования завершится сам при закрытии канала)
    {
        let mut w = state.watcher.write();
        *w = None;
    }
    if let Err(e) = crate::watcher::spawn_for_current(&app) {
        log::warn!("watcher не запущен: {e}");
    }

    // фоновая синхронизация интеграций: стартовый прогон + тикер интервалов
    if let Some(handle) = state.sync_task.lock().take() {
        handle.abort();
    }
    let app_bg = app.clone();
    *state.sync_task.lock() = Some(tauri::async_runtime::spawn(async move {
        crate::sync::startup_and_ticker(app_bg).await;
    }));
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

/// Выгружает текущий граф из памяти и останавливает watcher.
/// Файлы графа не трогаем — только «закрыть» в приложении.
#[tauri::command]
pub fn graph_close(state: tauri::State<'_, AppState>) {
    if let Some(handle) = state.sync_task.lock().take() {
        handle.abort();
    }
    *state.watcher.write() = None;
    *state.graph.write() = None;
    *state.root.write() = None;
}

/// Список журналов (имена), последние n
#[tauri::command]
pub async fn journal_list(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    Ok(sorted_journals(graph))
}

/// N журналов, идущих перед указанной датой (для ленты при скролле вниз).
/// sorted_journals отсортирован от новых к старым, поэтому «перед датой»
/// (более старые) — это элементы ПОСЛЕ позиции before.
#[tauri::command]
pub async fn journal_prev(
    before: String,
    n: usize,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;
    let journals = sorted_journals(graph);
    Ok(prev_journals_slice(&journals, &before, n))
}

/// Срез журналов старше даты before (journals отсортированы от новых к старым)
fn prev_journals_slice(journals: &[String], before: &str, n: usize) -> Vec<String> {
    let pos = journals
        .iter()
        .position(|j| j == before)
        .unwrap_or(journals.len());
    let start = (pos + 1).min(journals.len());
    let end = (start + n).min(journals.len());
    journals[start..end].to_vec()
}

/// Возвращает страницу (журнал или обычную) с блоками
#[tauri::command]
pub async fn page_get(name: String, state: tauri::State<'_, AppState>) -> Result<PageDto, String> {
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
pub async fn search(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
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
        // преамбулу показываем без служебных page-props и пустых строк
        preamble: page
            .preamble
            .iter()
            .filter(|l| !l.trim().is_empty() && !crate::core::parser::is_prop_line(l))
            .cloned()
            .collect(),
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

/// Путь к графу по умолчанию: переменная окружения LOGTASK_GRAPH,
/// иначе последний из недавних графов. None — граф ещё не выбран
/// (пользователь выбирает его в приложении через диалог).
pub fn default_graph_path() -> Option<String> {
    if let Ok(p) = std::env::var("LOGTASK_GRAPH") {
        if std::path::Path::new(&p).is_dir() {
            return Some(p);
        }
    }
    crate::recent::list().first().map(|g| g.path.clone())
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

/// Переименовывает страницу: файл + ссылки на неё во всех файлах графа.
/// Индекс перестраивается через reindex_and_emit — фронт получает
/// graph-changed с уже новым именем.
#[tauri::command]
pub async fn page_rename(
    old_name: String,
    new_name: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .rename_page(&old_name, &new_name, &root)
            .map_err(|e| format!("{e}"))?;
    }
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(())
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
#[serde(rename_all = "camelCase")]
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
    /// свойства блока (source-id, author, url…), отсортированные по ключу
    pub props: Vec<(String, String)>,
    /// исходник блока для инлайн-редактора в карточке задачи
    pub source: String,
    /// вложенные задачи (дочерние блоки-задачи, рекурсивно)
    pub children: Vec<TaskDto>,
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
    let mut props: Vec<(String, String)> = block
        .props
        .iter()
        // collapsed — служебное свойство Logseq, в карточке это шум
        .filter(|(k, _)| k.as_str() != "collapsed")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    props.sort();
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
        props,
        source: block.edit_source(),
        children: block
            .children
            .iter()
            .filter_map(|cid| graph.blocks.get(cid).map(|b| (*cid, b)))
            .filter(|(_, b)| b.is_task())
            .map(|(cid, b)| task_dto(graph, cid, b))
            .collect(),
    }
}

/// Убирает из выборки задачи, чей предок (по цепочке parent) тоже в выборке:
/// вложенные показываются внутри карточки родителя, а не отдельными карточками
fn strip_nested_tasks<'a>(
    graph: &Graph,
    tasks: Vec<(uuid::Uuid, &'a Block)>,
) -> Vec<(uuid::Uuid, &'a Block)> {
    let ids: std::collections::HashSet<uuid::Uuid> = tasks.iter().map(|(id, _)| *id).collect();
    tasks
        .into_iter()
        .filter(|(id, _)| {
            let mut cur = graph.blocks.get(id).and_then(|b| b.parent);
            while let Some(p) = cur {
                if ids.contains(&p) {
                    return false;
                }
                cur = graph.blocks.get(&p).and_then(|b| b.parent);
            }
            true
        })
        .collect()
}

/// Канбан: все задачи, сгруппированные по 6 статусам
#[tauri::command]
pub async fn kanban(state: tauri::State<'_, AppState>) -> Result<Vec<TaskColumn>, String> {
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

    for (id, block) in strip_nested_tasks(graph, graph.all_tasks()) {
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
    let entries = strip_nested_tasks(graph, graph.filter_tasks(&filter));
    Ok(entries
        .into_iter()
        .map(|(id, block)| task_dto(graph, id, block))
        .collect())
}

/// Квадрант матрицы Эйзенхауэра
#[derive(Debug, Clone, Serialize)]
pub struct MatrixQuadrant {
    pub key: String,
    pub label: String,
    /// (urgency, importance) для дроп-зоны
    pub urgency: String,
    pub importance: String,
    pub tasks: Vec<TaskDto>,
}

/// Матрица Эйзенхауэра: открытые задачи по 4 квадрантам
#[tauri::command]
pub async fn matrix(state: tauri::State<'_, AppState>) -> Result<Vec<MatrixQuadrant>, String> {
    use crate::core::model::{level_str, Level, Quadrant};

    let graph = state.graph.read();
    let graph = graph.as_ref().ok_or("граф не загружен")?;

    let mut quadrants: Vec<MatrixQuadrant> = vec![
        MatrixQuadrant {
            key: "do".into(),
            label: "Сделать".into(),
            urgency: level_str(Level::High),
            importance: level_str(Level::High),
            tasks: vec![],
        },
        MatrixQuadrant {
            key: "schedule".into(),
            label: "Запланировать".into(),
            urgency: level_str(Level::Low),
            importance: level_str(Level::High),
            tasks: vec![],
        },
        MatrixQuadrant {
            key: "delegate".into(),
            label: "Делегировать".into(),
            urgency: level_str(Level::High),
            importance: level_str(Level::Low),
            tasks: vec![],
        },
        MatrixQuadrant {
            key: "drop".into(),
            label: "Отбросить".into(),
            urgency: level_str(Level::Low),
            importance: level_str(Level::Low),
            tasks: vec![],
        },
    ];

    let by_key: [(&str, usize); 4] = [("do", 0), ("schedule", 1), ("delegate", 2), ("drop", 3)];

    for (id, block) in strip_nested_tasks(graph, graph.all_tasks()) {
        // только открытые задачи
        if block.status.map(|s| s.is_done()).unwrap_or(false) {
            continue;
        }
        let q = block.quadrant();
        let key = match q {
            Quadrant::Do => "do",
            Quadrant::Schedule => "schedule",
            Quadrant::Delegate => "delegate",
            Quadrant::Drop => "drop",
        };
        let idx = by_key.iter().find(|(k, _)| *k == key).map(|(_, i)| *i);
        if let Some(idx) = idx {
            quadrants[idx].tasks.push(task_dto(graph, id, block));
        }
    }

    // внутри квадранта — по приоритету
    for q in quadrants.iter_mut() {
        q.tasks.sort_by(|a, b| {
            a.priority
                .clone()
                .unwrap_or("Z".into())
                .cmp(&b.priority.clone().unwrap_or("Z".into()))
                .then_with(|| a.page.cmp(&b.page))
        });
    }

    Ok(quadrants)
}

/// Меняет срочность/важность задачи (drag&drop в матрице). Перезаписывает .md.
#[tauri::command]
pub async fn task_set_quadrant(
    uuid: String,
    urgency: Option<String>,
    importance: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    use crate::core::model::{parse_level, Level};

    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;

    let parse = |v: Option<String>, name: &str| -> Result<Option<Level>, String> {
        v.map(|s| parse_level(&s).ok_or_else(|| format!("недопустимый уровень {name}: {s:?}")))
            .transpose()
    };
    let urgency = parse(urgency, "urgency")?;
    let importance = parse(importance, "importance")?;
    if urgency.is_none() && importance.is_none() {
        return Err("нужно указать хотя бы одно свойство".into());
    }

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .set_block_quadrant(&id, urgency, importance, &root)
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
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
    crate::core::fswrite::atomic_write(&path, &text).map_err(|e| e.to_string())
}

/// Импорт `:default-queries` из logseq/config.edn (разовый при первом старте):
/// переносит группы запросов (например, «Сейчас / Проекты / Остальные дела»)
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
    crate::core::fswrite::atomic_write(&path, &text).map_err(|e| e.to_string())?;
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

    // импортированная задача? (source:: + source-id::) — тогда write-back
    let push_info = {
        let graph = state.graph.read();
        graph
            .as_ref()
            .and_then(|g| g.blocks.get(&id))
            .and_then(|b| {
                let src = b.props.get("source")?.clone();
                let rid = b.props.get("source-id")?.clone();
                Some((src, rid))
            })
    };

    // переиндексируем и оповестим UI
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);

    if let Some((src, rid)) = push_info {
        tauri::async_runtime::spawn(async move {
            let settings = crate::settings::load(std::path::Path::new(&root));
            let Some(cfg) = settings
                .integrations
                .sources
                .iter()
                .find(|s| s.id == src && s.enabled)
            else {
                return;
            };
            let gkey = crate::sync::secrets::graph_key(std::path::Path::new(&root));
            if let Err(e) = crate::sync::push_status_standalone(cfg, &gkey, &rid, status).await {
                log::warn!("push статуса {rid} в {src}: {e}");
                crate::sync::state::record_error(std::path::Path::new(&root), &src, Some(e));
            }
        });
    }
    Ok(page)
}

/// Меняет текст блока (редактирование в UI)
#[tauri::command]
pub async fn block_update_text(
    uuid: String,
    content: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .set_block_text(&id, &content, &root)
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Удаляет блок и его поддерево
#[tauri::command]
pub async fn block_delete(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .delete_block(&id, &root)
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Результат склейки блоков: страница и свежий uuid выжившего блока
/// (после записи uuid пересоздаются — фронт продолжает редактирование)
#[derive(serde::Serialize)]
pub struct MergeResultDto {
    pub page: String,
    pub uuid: String,
}

async fn merge_cmd(
    uuid: String,
    op: &str,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MergeResultDto>, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;

    let res = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        let r = match op {
            "up" => graph.merge_block_up(&id, &root),
            "down" => graph.merge_block_down(&id, &root),
            "indent" => graph.indent_block(&id, &root),
            "outdent" => graph.outdent_block(&id, &root),
            other => return Err(format!("неизвестная операция: {other}")),
        };
        r.map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some((page, pos)) = res else {
        return Ok(None);
    };
    mark_self_write(&state);
    // полная переиндексация пересоздаёт uuid — находим финальный uuid
    // выжившего блока по его позиции уже в новом графе
    crate::watcher::reindex_and_emit(&app);
    let fresh_uuid = {
        let graph = state.graph.read();
        graph
            .as_ref()
            .and_then(|g| g.pages.get(&page))
            .and_then(|p| p.order.get(pos).copied())
    };
    Ok(fresh_uuid.map(|u| MergeResultDto {
        page,
        uuid: u.to_string(),
    }))
}

/// Лог-мост для отладки фронта: пишет сообщение в лог приложения
#[tauri::command]
pub fn log_frontend(msg: String) {
    log::info!("frontend: {msg}");
}

/// Склеивает блок с вышестоящим (Backspace в начале редактируемого блока,
/// как в Logseq): текст уходит вверх, дети переезжают, блок удаляется.
#[tauri::command]
pub async fn block_merge_up(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MergeResultDto>, String> {
    merge_cmd(uuid, "up", app, state).await
}

/// Склеивает блок с нижестоящим (Delete в конце редактируемого блока).
#[tauri::command]
pub async fn block_merge_down(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MergeResultDto>, String> {
    merge_cmd(uuid, "down", app, state).await
}

/// Tab: блок становится ребёнком предыдущего соседа (как в Logseq).
#[tauri::command]
pub async fn block_indent(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MergeResultDto>, String> {
    merge_cmd(uuid, "indent", app, state).await
}

/// Shift+Tab: блок поднимается на уровень родителя.
#[tauri::command]
pub async fn block_outdent(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MergeResultDto>, String> {
    merge_cmd(uuid, "outdent", app, state).await
}

/// Создаёт новый блок в конце страницы.
/// marker — один из LATER/TODO/DOING/... или null для обычного блока
#[tauri::command]
pub async fn block_create(
    page: String,
    content: String,
    marker: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let status = marker.as_deref().and_then(Status::from_marker);

    let uuid = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .append_block(&page, &content, status, &root)
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(_) = uuid else {
        return Err("страница не найдена".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(uuid.unwrap().to_string())
}

/// Создаёт файл сегодняшнего журнала (journals/YYYY_MM_DD.md), если его нет.
/// Ничего не делает, если файл существует.
fn ensure_today_journal(root: &std::path::Path, graph: &mut Graph) {
    let name = today_journal_name();
    if graph.pages.contains_key(&name) {
        return;
    }
    let path = root.join("journals").join(format!("{name}.md"));
    if path.exists() {
        return;
    }
    if let Err(e) = std::fs::create_dir_all(path.parent().unwrap_or(root)) {
        log::warn!("не удалось создать папку journals: {e}");
        return;
    }
    // Logseq добавляет заголовок-дату первой строкой
    let title = format!("- {}\n", journal_title(&name));
    if let Err(e) = crate::core::fswrite::atomic_write(&path, &title) {
        log::warn!("не удалось создать {path:?}: {e}");
        return;
    }
    log::info!("создана страница журнала: {name}");
    // индексируем новый файл, чтобы он появился сразу
    let mut stats = IndexStats {
        pages: 0,
        journals: 0,
        blocks: 0,
        tasks: 0,
        links: 0,
    };
    let rel = std::path::PathBuf::from(format!("journals/{name}.md"));
    graph.index_file_content(
        &name,
        crate::core::model::PageKind::Journal,
        &title,
        None,
        &mut stats,
        Some(rel),
    );
}

/// Имя сегодняшнего журнала: "2026_09_30"
fn today_journal_name() -> String {
    chrono::Local::now().format("%Y_%m_%d").to_string()
}

/// Заголовок журнала как в Logseq: "Sep 30th, 2026"
fn journal_title(name: &str) -> String {
    let mut parts = name.split('_');
    let (y, m, d) = (
        parts.next().unwrap_or("1970"),
        parts.next().unwrap_or("01"),
        parts.next().unwrap_or("01"),
    );
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let m_idx: usize = (m.parse::<usize>().unwrap_or(1)).saturating_sub(1).min(11);
    let day: u32 = d.parse().unwrap_or(1);
    let suffix = match day % 10 {
        1 if day != 11 => "st",
        2 if day != 12 => "nd",
        3 if day != 13 => "rd",
        _ => "th",
    };
    format!("{} {}{}, {}", month[m_idx], day, suffix, y)
}

/// Запускает CLOCK на задаче (если уже идёт — ничего не делает)
#[tauri::command]
pub async fn clock_start(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    clock_toggle(uuid, true, app, state).await
}

/// Останавливает CLOCK на задаче. Возвращает путь страницы (для переиндексации).
#[tauri::command]
pub async fn clock_stop(
    uuid: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    clock_toggle(uuid, false, app, state).await
}

async fn clock_toggle(
    uuid: String,
    start: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;
    let now = crate::core::model::org_timestamp_now();

    let result = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .mutate_block(&id, &root, |b| {
                if start {
                    b.clock_start(&now);
                } else {
                    let _ = b.clock_stop(&now);
                }
            })
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = result else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Настройки графа (тема, шрифты, статусы канбана)
#[tauri::command]
pub fn settings_get(
    state: tauri::State<'_, AppState>,
) -> Result<crate::settings::Settings, String> {
    let root = state.root.read().clone();
    Ok(root.map(|r| crate::settings::load(&r)).unwrap_or_default())
}

/// Сохраняет настройки графа
#[tauri::command]
pub fn settings_save(
    settings: crate::settings::Settings,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let root = state.root.read().clone();
    let Some(root) = root else {
        return Err("граф не загружен".into());
    };
    crate::settings::save(&root, &settings).map_err(|e| format!("ошибка: {e}"))
}

// ---------- Интеграции (синхронизация задач) ----------

/// Состояние источников: последний синк/ошибка (из integrations-state.json)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStateDto {
    pub id: String,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
    /// задан ли токен в keyring (только если источник его использует)
    pub secret_set: Option<bool>,
}

#[tauri::command]
pub fn integrations_states(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SourceStateDto>, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let settings = crate::settings::load(&root);
    let st = crate::sync::state::load(&root);
    let gkey = crate::sync::secrets::graph_key(&root);
    Ok(settings
        .integrations
        .sources
        .iter()
        .map(|cfg| {
            let s = st.sources.get(&cfg.id);
            SourceStateDto {
                id: cfg.id.clone(),
                last_sync: s.and_then(|x| x.last_sync.clone()),
                last_error: s.and_then(|x| x.last_error.clone()),
                secret_set: cfg
                    .token_ref
                    .as_deref()
                    .map(|t| crate::sync::secrets::is_set(&gkey, t)),
            }
        })
        .collect())
}

/// Сохраняет секрет (токен) в системное хранилище. В settings.json
/// попадает только имя (tokenRef / ${secret:имя}).
#[tauri::command]
pub fn integrations_set_secret(
    name: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let gkey = crate::sync::secrets::graph_key(&root);
    let r = crate::sync::secrets::set(&gkey, &name, &value);
    match &r {
        Ok(()) => log::info!("секрет {name:?} сохранён в keyring (граф {gkey})"),
        Err(e) => log::warn!("секрет {name:?} НЕ сохранён: {e}"),
    }
    r
}

/// Проверка подключения: fetch без записи в граф. Возвращает число задач.
#[tauri::command]
pub async fn integrations_test(
    source: crate::sync::config::SourceConfig,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let client = crate::sync::http::client()?;
    let tasks =
        crate::sync::fetch_all(&client, &source, &crate::sync::secrets::graph_key(&root)).await?;
    Ok(tasks.len())
}

/// Ручная синхронизация: одного источника (sourceId) или всех включённых
#[tauri::command]
pub async fn integrations_sync(
    source_id: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<crate::sync::SyncReport>, String> {
    let root = state.root.read().clone().ok_or("граф не загружен")?;
    let settings = crate::settings::load(&root);
    let mut reports = vec![];
    for cfg in settings
        .integrations
        .sources
        .iter()
        .filter(|s| s.enabled && source_id.as_ref().map(|id| &s.id == id).unwrap_or(true))
    {
        reports.push(crate::sync::sync_source(&app, &state, cfg).await);
    }
    Ok(reports)
}

/// Устанавливает приоритет задачи ([#A]/[#B]/[#C] или сброс)
#[tauri::command]
pub async fn task_set_priority(
    uuid: String,
    priority: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    use crate::core::model::Priority;

    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;
    let prio = match priority.as_deref() {
        None => None,
        Some("A") => Some(Priority::A),
        Some("B") => Some(Priority::B),
        Some("C") => Some(Priority::C),
        Some(other) => {
            return Err(format!(
                "недопустимый приоритет: {other:?} (ожидалось A/B/C или null)"
            ))
        }
    };

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .mutate_block(&id, &root, |b| b.set_priority(prio))
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Устанавливает свойство (deadline/scheduled/urgency/importance…)
#[tauri::command]
pub async fn block_set_prop(
    uuid: String,
    key: String,
    value: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let id = uuid::Uuid::parse_str(&uuid).map_err(|e| format!("невалидный uuid: {e}"))?;

    let page = {
        let mut graph = state.graph.write();
        let Some(graph) = graph.as_mut() else {
            return Err("граф не загружен".into());
        };
        graph
            .mutate_block(&id, &root, |b| b.set_prop(&key, value.as_deref()))
            .map_err(|e| format!("ошибка записи: {e}"))?
    };

    let Some(page) = page else {
        return Err("блок не найден в графе".into());
    };
    mark_self_write(&state);
    crate::watcher::reindex_and_emit(&app);
    Ok(page)
}

/// Список недавних графов
#[tauri::command]
pub fn recent_graphs() -> Vec<crate::recent::RecentGraph> {
    crate::recent::list()
}

/// Удаляет граф из списка недавних (сам граф с диска не трогаем)
#[tauri::command]
pub fn recent_remove(path: String) {
    crate::recent::remove(&path);
}

/// Диалог выбора папки графа (нативный)
#[tauri::command]
pub async fn pick_graph_dir(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(title.as_deref().unwrap_or("Выбрать папку графа Logseq"))
        .pick_folder(move |folder| {
            let _ = tx.send(folder);
        });

    let result = rx.recv().map_err(|e| format!("ошибка диалога: {e}"))?;
    Ok(result.map(|f| f.to_string()))
}

/// Создаёт пустую структуру графа с нуля (journals/ + pages/)
/// в выбранной папке. Существующие файлы не трогаются.
#[tauri::command]
pub async fn graph_create(path: String) -> Result<(), String> {
    let root = std::path::Path::new(&path);
    if root.exists() && !root.is_dir() {
        return Err(format!("не папка: {path}"));
    }
    crate::core::fswrite::scaffold_graph(root).map_err(|e| format!("не удалось создать граф: {e}"))
}

/// true, если в папке нет ни journals/, ни pages/ — кандидат на создание
/// нового графа (спросить пользователя перед scaffold)
#[tauri::command]
pub async fn graph_needs_scaffold(path: String) -> Result<bool, String> {
    let root = std::path::Path::new(&path);
    if !root.is_dir() {
        return Ok(true);
    }
    Ok(!root.join("journals").is_dir() && !root.join("pages").is_dir())
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

/// Резолв пути ассета внутри графа. Logseq пишет ссылки на картинки
/// относительно md-файла (`../assets/x.png` из journals/ и pages/),
/// поэтому ведущие `..`/`./` отбрасываются и путь ищется от корня графа
/// (ассеты всегда лежат в корне). Выход за пределы графа запрещён.
fn resolve_asset_path(root: &std::path::Path, path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::{Component, Path, PathBuf};

    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("корень графа: {e}"))?;
    let p = Path::new(path);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let stripped: PathBuf = p
            .components()
            .skip_while(|c| matches!(c, Component::ParentDir | Component::CurDir))
            .collect();
        root_canon.join(stripped)
    };
    let canon = joined
        .canonicalize()
        .map_err(|e| format!("файл не найден: {path}: {e}"))?;
    if !canon.starts_with(&root_canon) {
        return Err(format!("путь за пределами графа: {path}"));
    }
    Ok(canon)
}

/// Картинка из графа как data-URL (для <img> в webview).
#[tauri::command]
pub async fn asset_data_url(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let root = state.root.read().clone();
    let root = root.ok_or("граф не загружен")?;
    let canon = resolve_asset_path(&root, &path)?;
    let data = std::fs::read(&canon).map_err(|e| format!("чтение {path}: {e}"))?;
    let mime = match canon
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", base64_encode(&data)))
}

/// Открывает внешнюю ссылку в системном браузере (через Rust API
/// opener-плагина — JS-вызов на этой системе молча не срабатывает)
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

/// Favicon домена ссылки как data-URL. Грузится через reqwest (rustls):
/// webview на этой системе https грузить не может («TLS support is not
/// available»). Кэш — в памяти; пустая строка = «иконки нет».
#[tauri::command]
pub async fn favicon_data_url(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let host = {
        let u = reqwest::Url::parse(&url).map_err(|e| format!("url: {e}"))?;
        u.host_str().unwrap_or("").to_string()
    };
    if host.is_empty() {
        return Err("нет домена в ссылке".into());
    }
    if let Some(cached) = state.favicons.read().get(&host) {
        return if cached.is_empty() {
            Err("иконки нет (кэш)".into())
        } else {
            Ok(cached.clone())
        };
    }

    let result = fetch_favicon(&host).await;
    state
        .favicons
        .write()
        .insert(host, result.clone().unwrap_or_default());
    result
}

async fn fetch_favicon(host: &str) -> Result<String, String> {
    let client = crate::sync::http::client()?;
    let url = format!("https://{host}/favicon.ico");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("favicon {host}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("favicon {host}: HTTP {}", resp.status()));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/x-icon")
        .split(';')
        .next()
        .unwrap_or("image/x-icon")
        .to_string();
    let data = resp
        .bytes()
        .await
        .map_err(|e| format!("favicon {host}: {e}"))?;
    if data.is_empty() {
        return Err(format!("favicon {host}: пустой ответ"));
    }
    Ok(format!("data:{mime};base64,{}", base64_encode(&data)))
}

/// Заголовок веб-страницы по ссылке (тег <title>): голые URL в режиме
/// просмотра показываются заголовком, как в Logseq. Кэш — в памяти;
/// пустая строка = «заголовка нет/ошибка».
#[tauri::command]
pub async fn web_title(url: String, state: tauri::State<'_, AppState>) -> Result<String, String> {
    if let Some(cached) = state.webtitles.read().get(&url) {
        return if cached.is_empty() {
            Err("заголовка нет (кэш)".into())
        } else {
            Ok(cached.clone())
        };
    }
    let result = fetch_title(&url).await;
    state
        .webtitles
        .write()
        .insert(url, result.clone().unwrap_or_default());
    result
}

async fn fetch_title(url: &str) -> Result<String, String> {
    let client = crate::sync::http::client()?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("title {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("title {url}: HTTP {}", resp.status()));
    }
    // читаем целиком и обрезаем: <title> живёт в начале документа
    let body = resp.text().await.map_err(|e| format!("title {url}: {e}"))?;
    let html = body.chars().take(256 * 1024).collect::<String>();
    let lower = html.to_lowercase();
    let start = lower
        .find("<title")
        .and_then(|i| lower[i..].find('>').map(|j| i + j + 1))
        .ok_or("нет <title>")?;
    let end = lower[start..]
        .find("</title>")
        .map(|j| start + j)
        .ok_or("нет </title>")?;
    let title = html[start..end].trim().to_string();
    if title.is_empty() {
        return Err("пустой <title>".into());
    }
    Ok(decode_entities(&title))
}

/// Минимальное раскодирование HTML-сущностей в заголовке
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// Минимальный base64 без внешних зависимостей
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, prev_journals_slice};

    #[test]
    fn base64_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    fn js(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prev_returns_older_days() {
        let j = js(&[
            "2026_10_02",
            "2026_10_01",
            "2026_09_30",
            "2026_09_29",
            "2026_09_28",
        ]);
        assert_eq!(
            prev_journals_slice(&j, "2026_10_01", 2),
            js(&["2026_09_30", "2026_09_29"])
        );
    }

    #[test]
    fn prev_from_first_day() {
        let j = js(&["2026_10_02", "2026_10_01", "2026_09_30"]);
        assert_eq!(
            prev_journals_slice(&j, "2026_10_02", 5),
            js(&["2026_10_01", "2026_09_30"])
        );
    }

    #[test]
    fn prev_at_oldest_returns_empty() {
        let j = js(&["2026_10_02", "2026_10_01"]);
        assert!(prev_journals_slice(&j, "2026_10_01", 5).is_empty());
    }

    #[test]
    fn prev_unknown_date_returns_empty() {
        let j = js(&["2026_10_02"]);
        assert!(prev_journals_slice(&j, "2020_01_01", 5).is_empty());
    }

    /// Временный мини-граф: journals/ + assets/pic.png
    fn temp_graph(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("logtask-asset-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("journals")).unwrap();
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets/pic.png"), b"\x89PNG").unwrap();
        dir
    }

    #[test]
    fn asset_plain_relative_path() {
        let root = temp_graph("plain");
        let got = super::resolve_asset_path(&root, "assets/pic.png").unwrap();
        assert!(got.ends_with("assets/pic.png"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn asset_dotdot_from_journal_resolves_to_root() {
        // Logseq пишет ../assets/x.png относительно файла в journals/
        let root = temp_graph("dotdot");
        let got = super::resolve_asset_path(&root, "../assets/pic.png").unwrap();
        assert!(got.ends_with("assets/pic.png"));
        assert!(got.starts_with(root.canonicalize().unwrap()));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn asset_missing_file_errors() {
        let root = temp_graph("missing");
        assert!(super::resolve_asset_path(&root, "../assets/nope.png").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn asset_escape_outside_root_forbidden() {
        let root = temp_graph("escape");
        assert!(super::resolve_asset_path(&root, "/etc/hostname").is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
