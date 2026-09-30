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

#[test]
fn update_text_preserves_marker_and_props() {
    let dir = std::env::temp_dir().join("logtask_text_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_05.md");
    fs::write(&file, "- TODO [#B] старый текст\n  urgency:: high\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    graph.set_block_text(&id, "новый текст", &dir).unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("- TODO [#B] новый текст"), "{after}");
    assert!(after.contains("urgency:: high"), "{after}");
}

#[test]
fn append_block_adds_to_page() {
    use logtask_lib::core::model::Status;

    let dir = std::env::temp_dir().join("logtask_append_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_06.md");
    fs::write(&file, "- первая строка\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let id = graph
        .append_block("2026_10_06", "новая задача", Some(Status::Todo), &dir)
        .unwrap()
        .expect("создан");

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("- первая строка"), "{after}");
    assert!(after.contains("- TODO новая задача"), "{after}");

    // uuid в графе после переиндексации (парсер генерит новый)
    let created = graph
        .pages
        .get("2026_10_06")
        .and_then(|p| p.order.last().copied())
        .expect("страница есть");
    let block = graph.blocks.get(&created).expect("блок есть");
    assert_eq!(block.content, "новая задача");
    assert_eq!(block.status, Some(Status::Todo));
    let _ = id;
}

#[test]
fn delete_block_removes_subtree() {
    let dir = std::env::temp_dir().join("logtask_delete_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_07.md");
    fs::write(
        &file,
        "- оставляем\n- TODO удаляем\n\t- ребёнок\n\t- ещё ребёнок\n",
    )
    .unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("удаляем"))
        .expect("задача найдена");

    graph.delete_block(&id, &dir).unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("- оставляем"), "{after}");
    assert!(!after.contains("удаляем"), "{after}");
    assert!(!after.contains("ребёнок"), "{after}");
    assert_eq!(graph.blocks.len(), 1);
}

#[test]
fn clock_start_creates_logbook() {
    use logtask_lib::core::model::org_timestamp;

    let dir = std::env::temp_dir().join("logtask_clock_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_08.md");
    fs::write(&file, "- TODO задача для таймера\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    let start = org_timestamp(1_800_000_000); // фиксированное время
    graph
        .mutate_block(&id, &dir, |b| b.clock_start(&start))
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains(":LOGBOOK:"), "{after}");
    assert!(after.contains("CLOCK: ["), "{after}");
    assert!(after.contains(":END:"), "{after}");

    // останавливаем — появляется длительность.
    // внимание: после mutate_block uuid пересоздаётся (переиндексация),
    // поэтому находим блок заново по содержанию
    let end = org_timestamp(1_800_003_648); // +1:00:48
    let id2 = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("таймера"))
        .map(|(id, _)| id)
        .expect("задача найдена");
    graph
        .mutate_block(&id2, &dir, |b| {
            let dur = b.clock_stop(&end);
            assert_eq!(dur.as_deref(), Some("=>  1:00:48"));
        })
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("=>  1:00:48"), "{after}");
}

#[test]
fn clock_start_twice_keeps_single_running() {
    use logtask_lib::core::model::org_timestamp;

    let dir = std::env::temp_dir().join("logtask_clock_test2");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_09.md");
    fs::write(&file, "- TODO задача\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    let t = org_timestamp(1_800_000_000);
    graph
        .mutate_block(&id, &dir, |b| b.clock_start(&t))
        .unwrap();
    // uuid пересоздался — ищем заново
    let id2 = graph
        .all_tasks()
        .into_iter()
        .map(|(id, _)| id)
        .next()
        .expect("задача есть");
    graph
        .mutate_block(&id2, &dir, |b| b.clock_start(&t))
        .unwrap();

    let after = fs::read_to_string(&file).unwrap();
    let clock_count = after.matches("CLOCK: [").count();
    assert_eq!(clock_count, 1, "только один открытый CLOCK:\n{after}");
}

#[test]
fn set_priority_and_deadline() {
    let dir = std::env::temp_dir().join("logtask_prio_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_10.md");
    fs::write(&file, "- TODO задача без приоритета\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    let (id, _) = graph.all_tasks().into_iter().next().expect("есть задача");

    graph
        .mutate_block(&id, &dir, |b| {
            b.set_priority(Some(logtask_lib::core::model::Priority::A));
        })
        .unwrap();
    let after = fs::read_to_string(&file).unwrap();
    assert!(
        after.contains("- TODO [#A] задача без приоритета"),
        "{after}"
    );

    // смена A → C
    let id2 = graph
        .all_tasks()
        .into_iter()
        .map(|(id, _)| id)
        .next()
        .expect("задача есть");
    graph
        .mutate_block(&id2, &dir, |b| {
            b.set_priority(Some(logtask_lib::core::model::Priority::C));
        })
        .unwrap();
    let after = fs::read_to_string(&file).unwrap();
    assert!(
        after.contains("- TODO [#C] задача без приоритета"),
        "{after}"
    );

    // deadline
    let id3 = graph
        .all_tasks()
        .into_iter()
        .map(|(id, _)| id)
        .next()
        .expect("задача есть");
    graph
        .mutate_block(&id3, &dir, |b| b.set_prop("deadline", Some("2026-10-15")))
        .unwrap();
    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("deadline:: 2026-10-15"), "{after}");
    assert!(after.contains("- TODO [#C] задача"), "{after}");
}
