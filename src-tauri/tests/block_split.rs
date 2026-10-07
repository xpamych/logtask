//! Тест разбиения блока по курсору (Enter в редакторе): запись на диск,
//! позиция нового блока, наследование маркера статуса.

use std::fs;

use logtask_lib::core::model::{Graph, Status};

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
fn split_at_end_creates_empty_block_and_inherits_status() {
    let (dir, file) = setup("logtask_split_test2", "- TODO задача\n  - ребёнок\n");
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let id = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.content.contains("задача"))
        .map(|(id, _)| id)
        .expect("задача найдена");

    let (_, pos) = graph
        .split_block(&id, "задача", "", &dir)
        .expect("запись")
        .expect("блок разбился");
    // новый блок — после поддерева (ребёнок остаётся у исходного)
    assert_eq!(pos, 2);

    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, "- TODO задача\n  - ребёнок\n- TODO \n");

    let page = &graph.pages["2026_10_07"];
    let new_id = page.order[2];
    assert_eq!(graph.blocks[&new_id].status, Some(Status::Todo));
    assert_eq!(graph.blocks[&new_id].content, "");
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
