//! Smoke-тест матрицы Эйзенхауэра на реальном графе.
//! Запуск: LOGTASK_GRAPH=/путь/к/графу cargo test matrix_real --release -- --ignored --nocapture
use std::path::Path;

use logtask_lib::core::model::{Graph, Quadrant};

#[test]
#[ignore]
fn matrix_real_graph() {
    let Ok(root) = std::env::var("LOGTASK_GRAPH") else {
        eprintln!("LOGTASK_GRAPH не задан — тест пропущен");
        return;
    };
    let mut graph = Graph::default();
    graph.index_dir(Path::new(&root)).expect("индексация графа");

    let mut counts = [0usize; 4];
    let mut open = 0usize;
    for (_, b) in graph.all_tasks() {
        if b.status.map(|s| s.is_done()).unwrap_or(false) {
            continue;
        }
        open += 1;
        counts[quadrant_index(b.quadrant())] += 1;
    }

    eprintln!("открытых задач: {open}");
    eprintln!(
        "  Сделать: {}  Запланировать: {}  Делегировать: {}  Отбросить: {}",
        counts[0], counts[1], counts[2], counts[3]
    );
    assert_eq!(
        counts.iter().sum::<usize>(),
        open,
        "все открытые задачи распределены"
    );

    // задачи с высоким приоритетом должны попадать в важные квадранты
    let mut high_importance = 0;
    for (_, b) in graph.all_tasks() {
        if b.status.map(|s| s.is_done()).unwrap_or(false) {
            continue;
        }
        if b.effective_importance() == logtask_lib::core::model::Level::High {
            high_importance += 1;
        }
    }
    eprintln!("задач с высокой важностью: {high_importance}");
    assert_eq!(counts[0] + counts[1], high_importance);
}

fn quadrant_index(q: Quadrant) -> usize {
    match q {
        Quadrant::Do => 0,
        Quadrant::Schedule => 1,
        Quadrant::Delegate => 2,
        Quadrant::Drop => 3,
    }
}
