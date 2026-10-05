//! Тест переименования страницы: файл переименовывается, ссылки в других
//! файлах переписываются, журналы и конфликты имён отклоняются.

use std::fs;

use logtask_lib::core::model::Graph;

fn make_graph(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::create_dir_all(dir.join("journals")).unwrap();
    dir
}

#[test]
fn rename_moves_file_and_rewrites_refs() {
    let dir = make_graph("logtask_rename_test1");
    fs::write(dir.join("pages/Старая.md"), "- TODO задача\n").unwrap();
    fs::write(
        dir.join("pages/Другая.md"),
        "- ссылка [[Старая]] и псевдоним [[Старая|стр.]]\n- тег #[[Старая]]\n",
    )
    .unwrap();
    fs::write(
        dir.join("journals/2026_10_01.md"),
        "- дневник про [[Старая]]\n",
    )
    .unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    graph.rename_page("Старая", "Новая", &dir).expect("rename");

    // файл переименован
    assert!(!dir.join("pages/Старая.md").exists());
    assert!(dir.join("pages/Новая.md").exists());
    assert_eq!(
        fs::read_to_string(dir.join("pages/Новая.md")).unwrap(),
        "- TODO задача\n"
    );

    // ссылки в другой странице переписаны
    let other = fs::read_to_string(dir.join("pages/Другая.md")).unwrap();
    assert_eq!(
        other, "- ссылка [[Новая]] и псевдоним [[Новая|стр.]]\n- тег #[[Новая]]\n",
        "{other}"
    );

    // ссылка в журнале переписана
    let journal = fs::read_to_string(dir.join("journals/2026_10_01.md")).unwrap();
    assert_eq!(journal, "- дневник про [[Новая]]\n", "{journal}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_updates_index_after_reindex() {
    let dir = make_graph("logtask_rename_test2");
    fs::write(dir.join("pages/A.md"), "- задача\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    graph.rename_page("A", "B", &dir).unwrap();

    // как делает reindex_and_emit: полная переиндексация с диска
    let mut fresh = Graph::default();
    fresh.index_dir(&dir).unwrap();
    assert!(!fresh.pages.contains_key("A"));
    assert!(fresh.pages.contains_key("B"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rejects_journal() {
    let dir = make_graph("logtask_rename_test3");
    fs::write(dir.join("journals/2026_10_01.md"), "- запись\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    let err = graph.rename_page("2026_10_01", "Другое", &dir).unwrap_err();
    assert!(err.to_string().contains("журнал"), "{err}");
    assert!(dir.join("journals/2026_10_01.md").exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rejects_existing_name_and_bad_chars() {
    let dir = make_graph("logtask_rename_test4");
    fs::write(dir.join("pages/A.md"), "- a\n").unwrap();
    fs::write(dir.join("pages/B.md"), "- b\n").unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    assert!(graph.rename_page("A", "B", &dir).is_err());
    assert!(graph.rename_page("A", "  ", &dir).is_err());
    assert!(graph.rename_page("A", "C/D", &dir).is_err());
    assert!(graph.rename_page("Несуществующая", "C", &dir).is_err());
    // ничего не переименовалось
    assert!(dir.join("pages/A.md").exists());
    assert!(dir.join("pages/B.md").exists());

    let _ = fs::remove_dir_all(&dir);
}
