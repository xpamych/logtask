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

fn graph_with_links(name: &str) -> (std::path::PathBuf, Graph) {
    let dir = make_graph(name);
    fs::write(dir.join("pages/A.md"), "- a\n").unwrap();
    fs::write(dir.join("pages/B.md"), "- [[A]]\n").unwrap();
    fs::write(dir.join("pages/C.md"), "- [[A|alias]]\n").unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    (dir, graph)
}

#[test]
fn rename_rejects_external_edit() {
    let (dir, mut graph) = graph_with_links("logtask_rename_external");
    fs::write(dir.join("pages/B.md"), "- внешняя правка\n").unwrap();
    fs::File::options()
        .write(true)
        .open(dir.join("pages/B.md"))
        .unwrap()
        .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(2))
        .unwrap();
    let actual = fs::metadata(dir.join("pages/B.md"))
        .and_then(|m| m.modified())
        .unwrap();
    assert_ne!(actual, graph.pages["B"].mtime.unwrap());

    let result = graph.rename_page("A", "Новая", &dir);

    assert!(result.is_err());
    assert!(dir.join("pages/A.md").exists());
    assert!(!dir.join("pages/Новая.md").exists());
    assert_eq!(
        fs::read_to_string(dir.join("pages/B.md")).unwrap(),
        "- внешняя правка\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rolls_back_failed_file() {
    let (dir, mut graph) = graph_with_links("logtask_rename_rollback");
    let failed = dir.join("pages/C.md");

    let result = graph.rename_page_with_writer("A", "Новая", &dir, |path, text| {
        if path == failed {
            Err(std::io::Error::other("сбой записи"))
        } else {
            logtask_lib::core::fswrite::atomic_write(path, text)
        }
    });

    assert!(result.is_err());
    assert!(dir.join("pages/A.md").exists());
    assert!(!dir.join("pages/Новая.md").exists());
    assert_eq!(
        fs::read_to_string(dir.join("pages/B.md")).unwrap(),
        "- [[A]]\n"
    );
    assert_eq!(
        fs::read_to_string(dir.join("pages/C.md")).unwrap(),
        "- [[A|alias]]\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn failed_rollback_reports_inconsistent_files() {
    let (dir, mut graph) = graph_with_links("logtask_rename_rollback_failure");
    let failed = dir.join("pages/C.md");
    let rollback_failed = dir.join("pages/B.md");
    let mut b_writes = 0;

    let result = graph.rename_page_with_writer("A", "Новая", &dir, |path, text| {
        if path == failed {
            return Err(std::io::Error::other("сбой записи"));
        }
        if path == rollback_failed {
            b_writes += 1;
            if b_writes > 1 {
                return Err(std::io::Error::other("сбой отката"));
            }
        }
        logtask_lib::core::fswrite::atomic_write(path, text)
    });

    let message = result.unwrap_err().to_string();
    assert!(message.contains("B.md"), "{message}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_does_not_overwrite_newer_external_edit() {
    let (dir, mut graph) = graph_with_links("logtask_rename_rollback_external");
    let failed = dir.join("pages/C.md");
    let changed = dir.join("pages/B.md");
    let mut first_b_write = true;

    let result = graph.rename_page_with_writer("A", "Новая", &dir, |path, text| {
        if path == failed {
            return Err(std::io::Error::other("сбой записи"));
        }
        if path == changed && first_b_write {
            first_b_write = false;
            logtask_lib::core::fswrite::atomic_write(path, text)?;
            fs::write(path, "- новая внешняя правка\n")?;
            return Ok(());
        }
        logtask_lib::core::fswrite::atomic_write(path, text)
    });

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(changed).unwrap(),
        "- новая внешняя правка\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn delete_rejects_external_edit() {
    let dir = make_graph("logtask_delete_external");
    fs::write(dir.join("pages/A.md"), "- a\n").unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    fs::write(dir.join("pages/A.md"), "- внешняя правка\n").unwrap();
    fs::File::options()
        .write(true)
        .open(dir.join("pages/A.md"))
        .unwrap()
        .set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(2))
        .unwrap();

    let result = graph.delete_page_file("A", &dir);

    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(dir.join("pages/A.md")).unwrap(),
        "- внешняя правка\n"
    );
    let _ = fs::remove_dir_all(&dir);
}
