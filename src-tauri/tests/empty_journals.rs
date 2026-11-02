//! Автоочистка журналов, которые в ленте показываются как пустые.

use std::fs;
use std::path::{Path, PathBuf};

use logtask_lib::core::model::Graph;

fn graph_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("logtask_empty_journals_{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    dir
}

fn cleanup(dir: &Path, today: &str) -> Vec<String> {
    let mut graph = Graph::default();
    graph.index_dir(dir).unwrap();
    graph.delete_empty_journals(dir, today).unwrap()
}

#[test]
fn deletes_past_journals_without_visible_entries() {
    let dir = graph_dir("delete");
    fs::write(dir.join("journals/2026_10_01.md"), "").unwrap();
    fs::write(dir.join("journals/2026_10_02.md"), "- Oct 2nd, 2026\n").unwrap();

    let removed = cleanup(&dir, "2026_11_02");

    assert_eq!(removed, vec!["2026_10_01", "2026_10_02"]);
    assert!(!dir.join("journals/2026_10_01.md").exists());
    assert!(!dir.join("journals/2026_10_02.md").exists());
}

#[test]
fn keeps_today_and_journals_with_content() {
    let dir = graph_dir("keep");
    fs::write(dir.join("journals/2026_11_02.md"), "").unwrap();
    fs::write(
        dir.join("journals/2026_10_01.md"),
        "- Oct 1st, 2026\n- Запись\n",
    )
    .unwrap();
    fs::write(dir.join("journals/2026_10_03.md"), "title:: Архив\n").unwrap();

    let removed = cleanup(&dir, "2026_11_02");

    assert!(removed.is_empty());
    assert!(dir.join("journals/2026_11_02.md").exists());
    assert!(dir.join("journals/2026_10_01.md").exists());
    assert!(dir.join("journals/2026_10_03.md").exists());
}
