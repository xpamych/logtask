//! Тест смены статуса задачи: запись на диск и переиндексация.

use std::fs;

use logtask_lib::core::model::{Graph, Status};

const JOURNAL: &str = "- TODO первая задача\n- вторая строка\n  - DONE вложенная\n";

#[test]
fn set_status_writes_file_and_reindexes() {
    let dir = std::env::temp_dir().join("logtask_status_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_09_30.md");
    fs::write(&file, JOURNAL).unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).expect("индексация");

    let (id, _) = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("первая"))
        .expect("задача найдена");

    let page = graph
        .set_block_status(&id, Status::Done, &dir)
        .expect("запись");
    assert_eq!(page, Some("2026_09_30".to_string()));

    // файл на диске обновился
    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("- DONE первая задача"), "{after}");
    // остальное содержимое не пострадало
    assert!(after.contains("- вторая строка"), "{after}");
    assert!(after.contains("- DONE вложенная"), "{after}");

    // граф переиндексирован: задача теперь Done
    // (uuid пересоздаётся при переиндексации — Logseq не хранит его в .md)
    let task = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("первая"))
        .expect("задача после переиндексации");
    assert_eq!(task.1.status, Some(Status::Done));
    assert!(graph.blocks.len() >= 3);
}

#[test]
fn set_status_keeps_indent_and_props() {
    let text = "- TODO [#A] задача с приоритетом\n  deadline:: 2026-10-05\n";
    let dir = std::env::temp_dir().join("logtask_status_test2");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_01.md");
    fs::write(&file, text).unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    graph.set_block_status(&id, Status::Canceled, &dir).unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(
        after.contains("- CANCELED [#A] задача с приоритетом"),
        "{after}"
    );
    assert!(after.contains("deadline:: 2026-10-05"), "{after}");
}
