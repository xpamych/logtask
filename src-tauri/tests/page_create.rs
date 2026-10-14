//! Тест создания новой страницы: пустой файл pages/<имя>.md на диске.

use std::fs;

use logtask_lib::core::model::Graph;

#[test]
fn create_page_writes_empty_file() {
    let dir = std::env::temp_dir().join("logtask_page_create_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&dir).expect("индексация");

    Graph::create_page_file("Новая страница", &dir).expect("создание");

    let file = dir.join("pages/Новая страница.md");
    assert!(file.exists(), "файл создан");
    assert_eq!(fs::read_to_string(&file).unwrap(), "", "файл пустой");

    // после переиндексации страница видна в графе
    graph.index_dir(&dir).expect("переиндексация");
    assert!(graph.pages.contains_key("Новая страница"));
}

#[test]
fn create_page_rejects_slash() {
    let dir = std::env::temp_dir().join("logtask_page_create_test_slash");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();

    let err = Graph::create_page_file("Foo/Bar", &dir).expect_err("ошибка на /");
    assert!(err.contains("недопустимое"), "{err}");
    assert!(!dir.join("pages/Foo").exists(), "ничего не создано");
}

#[test]
fn create_page_does_not_overwrite_existing_file() {
    let dir = std::env::temp_dir().join("logtask_page_create_test_exists");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    let file = dir.join("pages/Уже есть.md");
    fs::write(&file, "- TODO не трогать\n").unwrap();

    let err = Graph::create_page_file("Уже есть", &dir).expect_err("ошибка на существующий файл");
    assert!(err.contains("уже существует"), "{err}");
    assert_eq!(fs::read_to_string(&file).unwrap(), "- TODO не трогать\n");
}
