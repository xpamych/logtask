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
        text, "- первая\nвторая\n\t- вложенная\n- третья\n",
        "файл:\n{text}"
    );

    // и индекс соответствует: «вторая» — строка trailing первого блока,
    // вложенная — его ребёнок
    let first = block_id(&g, "Тест", "первая");
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
        text, "- родитель\n\tпервый ребёнок\n\t- второй\n",
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
    assert_eq!(
        text, "- первая\nвторая\n  source-id:: 42\n",
        "файл:\n{text}"
    );
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
    assert_eq!(g.blocks[&survivor].content, "первая");

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- первая\nвторая\n\t- вложенная\n", "файл:\n{text}");
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

/// Повторная индексация файла: склеенная строка должна остаться trailing
/// выжившего блока (на странице ровно один блок верхнего уровня).
fn assert_single_block_after_reindex(dir: &std::path::Path, page: &str, needle: &str) {
    let mut g2 = Graph::default();
    g2.index_dir(dir).unwrap();
    assert_eq!(
        g2.pages[page].roots.len(),
        1,
        "после повторной индексации блоков верхнего уровня больше одного"
    );
    let id = g2.pages[page].roots[0];
    assert!(
        g2.blocks[&id].content.contains(needle),
        "контент блока не содержит «{needle}»: {}",
        g2.blocks[&id].content
    );
}

#[test]
fn merge_into_code_fence_trailing() {
    // Первая строка склеиваемого блока становится отдельной строкой
    // сразу ПОСЛЕ последней строки вышестоящего блока (здесь — после
    // закрывающего фенса), с сохранением своего отступа.
    let (dir, mut g) = graph_with(
        "fence",
        "- Блок с кодом\n  ```\n  dnf install kea\n  ```\n- Следующий блок\n",
    );
    let id = block_id(&g, "Тест", "Следующий");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(
        text, "- Блок с кодом\n  ```\n  dnf install kea\n  ```\nСледующий блок\n",
        "файл:\n{text}"
    );
    assert_single_block_after_reindex(&dir, "Тест", "Блок с кодом");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_becomes_trailing_line() {
    // Простая склейка: склеиваемый блок перестаёт быть блоком —
    // его первая строка становится trailing-строкой вышестоящего.
    let (dir, mut g) = graph_with("nospace", "- Первый\n- Второй\n");
    let id = block_id(&g, "Тест", "Второй");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- Первый\nВторой\n", "файл:\n{text}");
    assert_single_block_after_reindex(&dir, "Тест", "Первый");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_bullet_text_becomes_escaped_trailing_line() {
    let (dir, mut g) = graph_with("bullet_text", "- Первый\n- - пункт\n");
    let id = block_id(&g, "Тест", "- пункт");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- Первый\n\\- пункт\n", "файл:\n{text}");
    assert_single_block_after_reindex(&dir, "Тест", "Первый");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_block_marker_becomes_text() {
    // Маркер склеиваемого блока не теряется: он становится обычным
    // текстом строки (ровно один пробел после маркера — из marker_str),
    // как в Logseq при переносе «TODO foo» в другую строку.
    let (dir, mut g) = graph_with("marker", "- Первый\n- TODO Второй\n");
    let id = block_id(&g, "Тест", "Второй");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- Первый\nTODO Второй\n", "файл:\n{text}");
    assert_single_block_after_reindex(&dir, "Тест", "Первый");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_drops_blank_separator() {
    // Blank-разделитель между блоками исчезает при склейке: строка
    // встаёт сразу после последней строки вышестоящего.
    let (dir, mut g) = graph_with("blank", "- Первый\n  note\n\n- Второй\n");
    let id = block_id(&g, "Тест", "Второй");

    g.merge_block_up(&id, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- Первый\n  note\nВторой\n", "файл:\n{text}");
    assert_single_block_after_reindex(&dir, "Тест", "Первый");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn merge_reindents_children_by_level() {
    // Поддерево переезжает с отступами по УРОВНЯМ: новый indent_str —
    // indent_str родителя + канонический tab на каждый уровень глубины,
    // независимо от исходного стиля отступов (пробелы/tab).
    let (dir, mut g) = graph_with("mixed", "- A\n- B\n  - child1\n\t- child2\n");
    let b = block_id(&g, "Тест", "B");
    let c1 = block_id(&g, "Тест", "child1");
    let c2 = block_id(&g, "Тест", "child2");
    assert_eq!(g.blocks[&c1].parent, Some(b));
    assert_eq!(g.blocks[&c2].parent, Some(b));

    g.merge_block_up(&b, &dir).unwrap();

    let text = fs::read_to_string(dir.join("pages/Тест.md")).unwrap();
    assert_eq!(text, "- A\nB\n\t- child1\n\t- child2\n", "файл:\n{text}");

    // повторная индексация с диска: «B» — trailing-строка A, у A два ребёнка
    let mut g2 = Graph::default();
    g2.index_dir(&dir).unwrap();
    let a2 = block_id(&g2, "Тест", "A");
    assert_eq!(g2.pages["Тест"].roots.len(), 1);
    let kids: Vec<_> = g2.blocks[&a2].children.clone();
    assert_eq!(kids.len(), 2);
    for k in kids {
        assert_eq!(g2.blocks[&k].indent, 1);
        assert_eq!(g2.blocks[&k].parent, Some(a2));
        assert_eq!(g2.blocks[&k].raw.indent_str, "\t");
    }
    let _ = fs::remove_dir_all(&dir);
}
