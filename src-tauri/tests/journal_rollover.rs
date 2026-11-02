//! Создание журнала нового дня без перезапуска приложения.

use std::fs;

use logtask_lib::core::model::Graph;

#[test]
fn creates_requested_journal_once_and_preserves_existing_file() {
    let dir = std::env::temp_dir().join("logtask_journal_rollover_test");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();

    assert!(Graph::ensure_journal_file(&dir, "2026_11_03").unwrap());
    let file = dir.join("journals/2026_11_03.md");
    assert_eq!(fs::read_to_string(&file).unwrap(), "- Nov 3rd, 2026\n");

    fs::write(&file, "- Nov 3rd, 2026\n- Запись\n").unwrap();
    assert!(!Graph::ensure_journal_file(&dir, "2026_11_03").unwrap());
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "- Nov 3rd, 2026\n- Запись\n"
    );
}
