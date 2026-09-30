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

#[test]
fn set_quadrant_writes_props() {
    use logtask_lib::core::model::Level;

    let dir = std::env::temp_dir().join("logtask_quadrant_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_02.md");
    fs::write(&file, "- TODO важная задача\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    graph
        .set_block_quadrant(&id, Some(Level::High), Some(Level::High), &dir)
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("urgency:: high"), "{after}");
    assert!(after.contains("importance:: high"), "{after}");
    // отступ 2 пробела — как в Logseq
    assert!(after.contains("\n  urgency:: high"), "{after}");
}

#[test]
fn set_quadrant_inserts_before_logbook() {
    use logtask_lib::core::model::Level;

    let dir = std::env::temp_dir().join("logtask_quadrant_logbook");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_03.md");
    fs::write(
        &file,
        "- TODO задача с логбуком\n  :LOGBOOK:\n  CLOCK: [2026-10-03 Mon 10:00]\n  :END:\n",
    )
    .unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    graph
        .set_block_quadrant(&id, Some(Level::Medium), None, &dir)
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    // свойство должно встать ПЕРЕД :LOGBOOK:
    let prop = after.find("urgency:: medium").unwrap();
    let logbook = after.find(":LOGBOOK:").unwrap();
    assert!(
        prop < logbook,
        "свойство должно быть перед LOGBOOK:\n{after}"
    );
    // логбук и часы не пострадали
    assert!(after.contains("CLOCK: [2026-10-03 Mon 10:00]"), "{after}");
    assert!(after.contains(":END:"), "{after}");
}

#[test]
fn set_quadrant_resets_prop() {
    use logtask_lib::core::model::Level;

    let dir = std::env::temp_dir().join("logtask_quadrant_reset");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_04.md");
    fs::write(
        &file,
        "- TODO задача\n  urgency:: high\n  importance:: low\n",
    )
    .unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    // обновляем urgency — importance не трогаем
    graph
        .set_block_quadrant(&id, Some(Level::Low), None, &dir)
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("urgency:: low"), "{after}");
    assert!(after.contains("importance:: low"), "{after}");
    assert!(!after.contains("urgency:: high"), "{after}");
}
