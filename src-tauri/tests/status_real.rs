//! Smoke-тест смены статуса на копии реального графа.
//! Запуск: cargo test status_real --release -- --ignored --nocapture
use std::fs;
use std::path::PathBuf;

use logtask_lib::core::model::{Graph, Status};

const GRAPH: &str = "/path/to/graph";

fn copy_graph(dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for dir in ["journals", "pages", "logseq"] {
        let src = PathBuf::from(GRAPH).join(dir);
        if !src.is_dir() {
            continue;
        }
        let dst_dir = dst.join(dir);
        fs::create_dir_all(&dst_dir)?;
        for entry in fs::read_dir(&src)? {
            let path = entry?.path();
            if path.is_file() {
                fs::copy(&path, dst_dir.join(path.file_name().unwrap()))?;
            }
        }
    }
    Ok(())
}

#[test]
#[ignore]
fn status_real_graph() {
    let tmp = std::env::temp_dir().join("logtask_real_status");
    let _ = fs::remove_dir_all(&tmp);
    copy_graph(&tmp).expect("копирование графа");

    let mut graph = Graph::default();
    let stats = graph.index_dir(&tmp).expect("индексация");
    eprintln!("граф: {} задач", stats.tasks);

    // берём первую TODO задачу
    let (id, block) = graph
        .all_tasks()
        .into_iter()
        .find(|(_, b)| b.status == Some(Status::Todo))
        .expect("есть TODO задача");
    let page = graph.page_of_block(&id);
    let file = {
        let p = graph.pages.get(&page).expect("страница есть");
        tmp.join(p.path.clone().expect("путь известен"))
    };
    let before = fs::read_to_string(&file).unwrap();
    let line_before = before
        .lines()
        .find(|l| l.contains(block.content.split('\n').next().unwrap_or("")))
        .unwrap_or("")
        .to_string();
    eprintln!("было:  {line_before}");

    graph
        .set_block_status(&id, Status::Doing, &tmp)
        .expect("смена статуса");

    let after = fs::read_to_string(&file).unwrap();
    assert!(after.contains("DOING"), "маркер должен стать DOING");
    let diff: Vec<(&str, &str)> = before
        .lines()
        .zip(after.lines())
        .filter(|(a, b)| a != b)
        .collect();
    eprintln!("изменено строк: {}", diff.len());
    for (a, b) in &diff {
        eprintln!("  - {a}\n  + {b}");
    }
    assert_eq!(diff.len(), 1, "должна измениться ровно одна строка");

    // откатываем, чтобы не оставлять мусор в копии
    fs::write(&file, before).unwrap();
}
