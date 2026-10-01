//! Тесты индексации графа на реальных фикстурах Logseq.

use logtask_lib::core::model::Graph;
use logtask_lib::core::model::{PageKind, Status};
use std::path::PathBuf;

fn fixture_graph() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/graph")
}

#[test]
fn indexes_fixture_graph() {
    let mut graph = Graph::default();
    let stats = graph.index_dir(&fixture_graph()).expect("индексация");

    // 2 журнала + 2 страницы
    assert_eq!(stats.journals, 2, "должно быть 2 журнала");
    assert!(stats.pages >= 2, "должно быть 2 страницы: {}", stats.pages);
    assert!(stats.blocks > 100, "блоков: {}", stats.blocks);
    assert!(stats.tasks > 20, "задач: {}", stats.tasks);
}

#[test]
fn parses_statuses_from_fixture() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let statuses: Vec<_> = graph
        .all_tasks()
        .iter()
        .filter_map(|(_, b)| b.status)
        .collect();
    assert!(
        statuses.contains(&Status::Done),
        "в фикстурах есть DONE-задачи"
    );
    assert!(statuses.contains(&Status::Todo));
}

#[test]
fn builds_backlinks() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    // из Пример - TODO.md есть [[Связанная страница]] и [[DevOps]]
    let bl = graph.backlinks_of("Связанная страница");
    assert!(
        !bl.is_empty(),
        "обратные ссылки на Связанная страница должны быть"
    );
    let bl_devops = graph.backlinks_of("DevOps");
    assert!(!bl_devops.is_empty(), "обратные ссылки на DevOps");
}

#[test]
fn page_of_block_and_names() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let names = graph.all_page_names();
    assert!(names.iter().any(|n| n == "Пример - TODO"));
    assert!(names.iter().any(|n| n == "Arch Linux"));

    // каждый блок знает свою страницу
    for (id, _) in graph.all_tasks() {
        let page = graph.page_of_block(&id);
        assert!(!page.is_empty(), "блок {id} без страницы");
    }
}

#[test]
fn kind_journal_detected() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let j = graph.pages.get("2026_09_11").expect("журнал 2026_09_11");
    assert_eq!(j.kind, PageKind::Journal);
    let p = graph.pages.get("Пример - TODO").expect("страница Пример");
    assert_eq!(p.kind, PageKind::Page);
}

#[test]
fn query_filters_by_page() {
    use logtask_lib::core::query::{SavedQuery, TaskFilter};

    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let q = SavedQuery {
        title: "Пример".into(),
        filter: TaskFilter {
            page: Some("Пример - TODO".into()),
            ..Default::default()
        },
        sort: vec![],
        collapsed: false,
    };
    let res = graph.query(&q);
    assert!(!res.is_empty(), "запрос по странице Пример пуст");
    for (id, _) in &res {
        assert_eq!(graph.page_of_block(id), "Пример - TODO");
    }
}

#[test]
fn query_open_only() {
    use logtask_lib::core::query::{SavedQuery, TaskFilter};

    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let q = SavedQuery {
        title: "Сейчас".into(),
        filter: TaskFilter {
            open: true,
            ..Default::default()
        },
        sort: vec![],
        collapsed: false,
    };
    let res = graph.query(&q);
    for (_, b) in &res {
        assert!(b.status.map(|s| !s.is_done()).unwrap_or(true));
    }
}

#[test]
fn matrix_quadrants() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();
    let m = graph.matrix();
    assert_eq!(m.len(), 4);
    let total: usize = m.iter().map(|q| q.len()).sum();
    assert_eq!(total, graph.all_tasks().len());
}

#[test]
fn search_finds_blocks() {
    let mut graph = Graph::default();
    graph.index_dir(&fixture_graph()).unwrap();

    let hits = graph.search("матриц", 10);
    assert!(!hits.is_empty(), "поиск «матриц» пуст");
}
