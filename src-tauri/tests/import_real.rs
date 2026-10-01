//! Smoke-тест импорта запросов из config.edn реального графа.
//! Запуск: LOGTASK_GRAPH=/путь/к/графу cargo test import_real -- --ignored --nocapture
use std::path::Path;

use logtask_lib::config_edn::parse_default_queries;
use logtask_lib::core::model::Graph;
use logtask_lib::core::query::{SavedQuery, TaskFilter};

/// Путь к реальному графу — из окружения; без него тест пропускается.
fn graph_path() -> Option<String> {
    std::env::var("LOGTASK_GRAPH")
        .ok()
        .filter(|p| !p.is_empty())
}

#[test]
#[ignore]
fn import_real_queries() {
    let Some(root) = graph_path() else {
        eprintln!("LOGTASK_GRAPH не задан — тест пропущен");
        return;
    };
    let cfg_path = Path::new(&root).join("logseq/config.edn");
    let cfg = std::fs::read_to_string(&cfg_path)
        .unwrap_or_else(|e| panic!("не могу прочитать {}: {e}", cfg_path.display()));

    let queries = parse_default_queries(&cfg);
    assert!(!queries.is_empty(), "запросы не найдены");
    eprintln!("найдено запросов: {}", queries.len());

    let mut graph = Graph::default();
    graph.index_dir(Path::new(&root)).expect("индексация графа");

    for q in &queries {
        let tasks = graph.query(&SavedQuery {
            title: q.title.clone(),
            filter: q.filter.clone(),
            sort: vec![],
            collapsed: false,
        });
        eprintln!(
            "  {:<16} задач: {:<4} status={:?} page={:?} prefix={:?} exclude={:?} open={}",
            q.title,
            tasks.len(),
            q.filter
                .status
                .iter()
                .map(|s| s.label())
                .collect::<Vec<_>>(),
            q.filter.page,
            q.filter.page_prefix,
            q.filter.exclude_page,
            q.filter.open
        );
        if q.filter.status.is_empty() {
            eprintln!("    ! статусы не распознались для «{}»", q.title);
        }
    }

    // канбан: все 6 статусов должны быть представлены на реальном графе
    let mut columns = std::collections::HashMap::new();
    for b in graph.blocks.values() {
        if b.is_task() {
            *columns.entry(b.status).or_insert(0usize) += 1;
        }
    }
    eprintln!(
        "канбан по статусам: {:?}",
        columns
            .iter()
            .map(|(s, n)| (s.map(|s| s.label()).unwrap_or("?"), *n))
            .collect::<Vec<_>>()
    );
    let total: usize = columns.values().sum();
    assert!(total > 100, "задач слишком мало");

    // open-фильтр: открытые = все, кроме Done/Canceled
    let open = graph.query(&SavedQuery {
        title: String::new(),
        filter: TaskFilter {
            open: true,
            ..Default::default()
        },
        sort: vec![],
        collapsed: false,
    });
    eprintln!("открытых задач: {}", open.len());
    assert!(open.len() < total);
}
