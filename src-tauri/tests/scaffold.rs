//! Создание графа с нуля: scaffold пустой структуры journals/ + pages/

use std::fs;

use logtask_lib::core::fswrite::scaffold_graph;
use logtask_lib::core::model::Graph;

#[test]
fn scaffold_creates_structure_and_loads() {
    let dir = std::env::temp_dir().join("logtask_scaffold_test");
    let _ = fs::remove_dir_all(&dir);

    let root = dir.join("новый граф");
    scaffold_graph(&root).unwrap();
    assert!(root.join("journals").is_dir());
    assert!(root.join("pages").is_dir());

    // идемпотентно: повторный вызов не падает и ничего не ломает
    scaffold_graph(&root).unwrap();

    // граф на пустой структуре индексируется без ошибок
    let mut graph = Graph::default();
    graph.index_dir(&root).unwrap();
    assert_eq!(graph.pages.len(), 0);
}
