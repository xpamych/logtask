//! Тест разбиения блока по курсору (Enter в редакторе): запись на диск,
//! позиция нового блока, создание обычного блока без маркера статуса.

use std::fs;

use logtask_lib::core::model::Graph;

fn setup(name: &str, text: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_10_07.md");
    fs::write(&file, text).unwrap();
    (dir, file)
}

#[test]
fn split_in_middle_creates_sibling_below() {
    let (dir, file) = setup(
        "logtask_split_test",
        "- первая часть вторая часть\n- следующий блок\n",
    );
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph
        .blocks
        .iter()
        .find(|(_, b)| b.content.contains("первая часть"))
        .map(|(id, b)| (*id, b.clone()))
        .expect("блок найден");

    let res = graph
        .split_block(&id, "первая часть", "вторая часть", &dir)
        .expect("запись");
    let (page, pos) = res.expect("блок разбился");
    assert_eq!(page, "2026_10_07");
    assert_eq!(pos, 1); // новый блок — сразу под исходным

    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, "- первая часть\n- вторая часть\n- следующий блок\n");

    // граф переиндексирован: три блока, у нового — тот же уровень
    let page = &graph.pages["2026_10_07"];
    assert_eq!(page.order.len(), 3);
    let new_id = page.order[1];
    assert_eq!(graph.blocks[&new_id].content, "вторая часть");
    assert_eq!(graph.blocks[&new_id].indent, 0);
}

#[test]
fn split_at_end_creates_plain_block_and_preserves_task_metadata() {
    let (dir, file) = setup(
        "logtask_split_test2",
        "- TODO [#B] задача\n  urgency:: low\n  importance:: medium\n  :LOGBOOK:\n  CLOCK: [2026-10-28 Wed 21:30:21]\n  :END:\n  - ребёнок\n",
    );
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let id = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("задача"))
        .map(|(id, _)| id)
        .expect("задача найдена");

    let (_, pos) = graph
        .split_block(
            &id,
            "[#B] задача\nurgency:: low\nimportance:: medium\n:LOGBOOK:\nCLOCK: [2026-10-28 Wed 21:30:21]\n:END:",
            "",
            &dir,
        )
        .expect("запись")
        .expect("блок разбился");
    // новый блок — после поддерева (ребёнок остаётся у исходного)
    assert_eq!(pos, 2);

    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, "- TODO [#B] задача\n  urgency:: low\n  importance:: medium\n  :LOGBOOK:\n  CLOCK: [2026-10-28 Wed 21:30:21]\n  :END:\n  - ребёнок\n- \n");

    let page = &graph.pages["2026_10_07"];
    let new_id = page.order[2];
    assert_eq!(graph.blocks[&new_id].status, None);
    assert!(graph.blocks[&new_id].props.is_empty());
    assert!(graph.blocks[&new_id].logbook.is_empty());
    assert_eq!(graph.blocks[&new_id].content, "");
}

#[test]
fn split_priority_only_task_does_not_add_urgency_to_plain_block() {
    let (dir, file) = setup(
        "logtask_split_priority_test",
        "- [#B] задача\n  importance:: medium\n",
    );
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let id = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content == "задача")
        .map(|(id, _)| id)
        .expect("задача найдена");

    graph
        .split_block(&id, "[#B] задача\nimportance:: medium", "", &dir)
        .expect("запись")
        .expect("блок разбился");

    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, "- [#B] задача\n  importance:: medium\n- \n");
}

#[test]
fn split_nested_block_keeps_indent() {
    let (dir, file) = setup("logtask_split_test3", "- родитель\n\t- вложенный текст\n");
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let (id, _) = graph
        .blocks
        .iter()
        .find(|(_, b)| b.content.contains("вложенный"))
        .map(|(id, b)| (*id, b.clone()))
        .expect("блок найден");

    graph
        .split_block(&id, "вложенный", "текст", &dir)
        .expect("запись")
        .expect("блок разбился");

    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, "- родитель\n\t- вложенный\n\t- текст\n");
}
