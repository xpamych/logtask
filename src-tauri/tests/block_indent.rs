//! Вложенность блоков: Tab (блок становится ребёнком предыдущего соседа)
//! и Shift+Tab (блок поднимается на уровень родителя), как в Logseq.

use std::fs;

use logtask_lib::core::model::Graph;

fn graph_with(tag: &str, page_text: &str) -> (std::path::PathBuf, Graph) {
    let dir = std::env::temp_dir().join(format!("logtask_indent_{}_{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::write(dir.join("pages/Тест.md"), page_text).unwrap();
    let mut g = Graph::default();
    g.index_dir(&dir).unwrap();
    (dir, g)
}

fn block_id(g: &Graph, page: &str, needle: &str) -> uuid::Uuid {
    g.pages[page]
        .order
        .iter()
        .find(|id| g.blocks[id].content.contains(needle))
        .copied()
        .unwrap_or_else(|| panic!("блок «{needle}» не найден"))
}

#[test]
fn indent_makes_block_child_of_previous_sibling() {
    let (dir, mut g) = graph_with("t1", "- первая\n- вторая\n\t- вложенная\n- третья\n");
    let id = block_id(&g, "Тест", "вторая");

    g.indent_block(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(
        text, "- первая\n\t- вторая\n\t\t- вложенная\n- третья\n",
        "файл:\n{text}"
    );
    // порядок в документе не изменился
    let first = block_id(&g, "Тест", "первая");
    let second = block_id(&g, "Тест", "вторая");
    assert_eq!(g.blocks[&second].parent, Some(first));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn indent_first_block_is_noop() {
    let (dir, mut g) = graph_with("t2", "- первая\n- вторая\n");
    let id = block_id(&g, "Тест", "первая");
    assert!(g.indent_block(&id, &dir).unwrap().is_none());
    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- первая\n- вторая\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn outdent_moves_block_after_parent_subtree() {
    let (dir, mut g) = graph_with(
        "t3",
        "- родитель\n\t- первый\n\t- второй\n\t\t- внук\n- после всего\n",
    );
    let id = block_id(&g, "Тест", "первый");

    g.outdent_block(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(
        text, "- родитель\n\t- второй\n\t\t- внук\n- первый\n- после всего\n",
        "файл:\n{text}"
    );
    assert_eq!(g.blocks[&block_id(&g, "Тест", "первый")].indent, 0);
    assert_eq!(g.blocks[&block_id(&g, "Тест", "первый")].parent, None);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn outdent_takes_children_along() {
    let (dir, mut g) = graph_with("t4", "- родитель\n\t- второй\n\t\t- внук\n");
    let id = block_id(&g, "Тест", "второй");

    g.outdent_block(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- родитель\n- второй\n\t- внук\n", "файл:\n{text}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn outdent_top_level_is_noop() {
    let (dir, mut g) = graph_with("t5", "- первая\n- вторая\n");
    let id = block_id(&g, "Тест", "первая");
    assert!(g.outdent_block(&id, &dir).unwrap().is_none());
    let _ = fs::remove_dir_all(&dir);
}
