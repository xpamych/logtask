//! Склеивание блоков: Backspace в начале блока присоединяет его
//! к вышестоящему (как в Logseq).

use std::fs;

use logtask_lib::core::model::Graph;

fn graph_with(tag: &str, page_text: &str) -> (std::path::PathBuf, Graph) {
    let dir = std::env::temp_dir().join(format!("logtask_merge_{}_{}", tag, std::process::id()));
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
fn merge_joins_text_and_moves_children() {
    let (dir, mut g) = graph_with("t1", "- первая\n- вторая\n\t- вложенная\n- третья\n");
    let id = block_id(&g, "Тест", "вторая");

    let page = g.merge_block_up(&id, &dir).unwrap();
    assert_eq!(page.map(|(p, _)| p), Some("Тест".to_string()));

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(
        text, "- первая вторая\n\t- вложенная\n- третья\n",
        "файл:\n{text}"
    );

    // и индекс соответствует: вложенная — ребёнок первой
    let first = block_id(&g, "Тест", "первая вторая");
    let child = block_id(&g, "Тест", "вложенная");
    assert_eq!(g.blocks[&child].parent, Some(first));
    assert_eq!(g.blocks[&child].indent, 1);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_first_child_into_parent() {
    let (dir, mut g) = graph_with("t2", "- родитель\n\t- первый ребёнок\n\t- второй\n");
    let id = block_id(&g, "Тест", "первый ребёнок");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(
        text, "- родитель первый ребёнок\n\t- второй\n",
        "файл:\n{text}"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_first_block_is_noop() {
    let (dir, mut g) = graph_with("t3", "- единственная сверху\n- вторая\n");
    let id = block_id(&g, "Тест", "единственная");

    let page = g.merge_block_up(&id, &dir).unwrap();
    assert!(page.is_none());
    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- единственная сверху\n- вторая\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_keeps_trailing_props() {
    let (dir, mut g) = graph_with("t4", "- первая\n- вторая\n  source-id:: 42\n");
    let id = block_id(&g, "Тест", "вторая");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- первая вторая\n  source-id:: 42\n", "файл:\n{text}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_down_pulls_next_block_up() {
    // Delete в конце блока: нижестоящий приклеивается к текущему,
    // uuid выжившего возвращается (фронт продолжает редактирование)
    let (dir, mut g) = graph_with("t5", "- первая\n- вторая\n\t- вложенная\n");
    let id = block_id(&g, "Тест", "первая");

    let Some((page, survivor_pos)) = g.merge_block_down(&id, &dir).unwrap() else {
        panic!("склейка не случилась");
    };
    assert_eq!(page, "Тест");
    // позиция выжившего указывает на склеенный блок
    let survivor = g.pages["Тест"].order[survivor_pos];
    assert_eq!(g.blocks[&survivor].content, "первая вторая");

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- первая вторая\n\t- вложенная\n", "файл:\n{text}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_down_last_block_is_noop() {
    let (dir, mut g) = graph_with("t6", "- первая\n- последняя\n");
    let id = block_id(&g, "Тест", "последняя");
    assert!(g.merge_block_down(&id, &dir).unwrap().is_none());
    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- первая\n- последняя\n");
    let _ = fs::remove_dir_all(&dir);
}
