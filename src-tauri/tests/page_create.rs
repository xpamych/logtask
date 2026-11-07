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
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(err.to_string().contains("недопустимое"), "{err}");
    assert!(!dir.join("pages/Foo").exists(), "ничего не создано");
}

#[test]
fn create_page_rejects_backslash() {
    let dir = std::env::temp_dir().join("logtask_page_create_test_backslash");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();

    let err = Graph::create_page_file("Foo\\Bar", &dir).expect_err("ошибка на \\");
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    assert!(err.to_string().contains("недопустимое"), "{err}");
    assert!(!dir.join("pages").join("Foo").exists(), "ничего не создано");
}

#[test]
fn create_page_rejects_empty_name() {
    let dir = std::env::temp_dir().join("logtask_page_create_test_empty");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();

    for bad in ["", "   "] {
        let err = Graph::create_page_file(bad, &dir).expect_err("ошибка на пустое имя");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
        assert!(err.to_string().contains("пустое"), "{err}");
    }
    assert!(
        fs::read_dir(dir.join("pages")).unwrap().next().is_none(),
        "ничего не создано"
    );
}

#[test]
fn create_page_does_not_overwrite_existing_file() {
    let dir = std::env::temp_dir().join("logtask_page_create_test_exists");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    let file = dir.join("pages/Уже есть.md");
    fs::write(&file, "- TODO не трогать\n").unwrap();

    let err = Graph::create_page_file("Уже есть", &dir).expect_err("ошибка на существующий файл");
    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    assert!(err.to_string().contains("уже существует"), "{err}");
    assert_eq!(fs::read_to_string(&file).unwrap(), "- TODO не трогать\n");
}

#[test]
fn ensure_page_allows_appending_first_block() {
    let dir = std::env::temp_dir().join("logtask_virtual_page_append_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::create_dir_all(dir.join("journals")).unwrap();
    fs::write(
        dir.join("journals/2026_11_07.md"),
        "- Упоминание [[Связанная страница]]\n",
    )
    .unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    graph
        .ensure_page("Связанная страница", &dir)
        .expect("создание");
    let uuid = graph
        .append_block("Связанная страница", "Первая запись", None, &dir)
        .expect("запись")
        .expect("uuid нового блока");

    assert_eq!(
        fs::read_to_string(dir.join("pages/Связанная страница.md")).unwrap(),
        "- Первая запись\n"
    );
    assert_eq!(graph.pages["Связанная страница"].order, vec![uuid]);
    assert_eq!(graph.blocks[&uuid].content, "Первая запись");
    let backlinks = &graph.backlinks["Связанная страница"];
    assert_eq!(backlinks.len(), 1);
    assert_eq!(graph.block_page[&backlinks[0]], "2026_11_07");
}

#[test]
fn ensure_page_keeps_existing_page() {
    let dir = std::env::temp_dir().join("logtask_virtual_page_existing_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::write(dir.join("pages/Уже есть.md"), "- Существующая запись\n").unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    graph.ensure_page("Уже есть", &dir).expect("без изменений");

    assert_eq!(
        fs::read_to_string(dir.join("pages/Уже есть.md")).unwrap(),
        "- Существующая запись\n"
    );
    assert_eq!(graph.pages["Уже есть"].order.len(), 1);
}

#[test]
fn ensure_page_does_not_overwrite_external_file() {
    let dir = std::env::temp_dir().join("logtask_virtual_page_external_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::write(dir.join("pages/Внешняя.md"), "- Внешняя правка\n").unwrap();
    let mut graph = Graph::default();

    let err = graph
        .ensure_page("Внешняя", &dir)
        .expect_err("гонка создания");

    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(
        fs::read_to_string(dir.join("pages/Внешняя.md")).unwrap(),
        "- Внешняя правка\n"
    );
    assert!(!graph.pages.contains_key("Внешняя"));
}

#[test]
fn ensure_page_rejects_invalid_and_journal_names() {
    let dir = std::env::temp_dir().join("logtask_virtual_page_invalid_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pages")).unwrap();
    let mut graph = Graph::default();

    for bad in ["", "   ", " Новая ", "Foo/Bar", "Foo\\Bar", "2026_11_07"] {
        let err = graph.ensure_page(bad, &dir).expect_err("недопустимое имя");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput, "{bad}");
    }
    assert!(fs::read_dir(dir.join("pages")).unwrap().next().is_none());
}

#[test]
fn ensure_page_keeps_existing_journal_appendable() {
    let dir = std::env::temp_dir().join("logtask_existing_journal_append_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    fs::write(dir.join("journals/2026_11_07.md"), "- Утренняя запись\n").unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();

    graph.ensure_page("2026_11_07", &dir).expect("журнал есть");
    graph
        .append_block("2026_11_07", "Новая запись", None, &dir)
        .expect("добавление в журнал")
        .expect("uuid нового блока");

    assert_eq!(
        fs::read_to_string(dir.join("journals/2026_11_07.md")).unwrap(),
        "- Утренняя запись\n- Новая запись\n"
    );
}
