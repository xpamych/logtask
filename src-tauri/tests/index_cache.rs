use std::fs;
use std::path::PathBuf;

use logtask_lib::core::model::Graph;
use logtask_lib::core::serializer::serialize_page;

struct TestGraph {
    root: PathBuf,
}

impl TestGraph {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "logtask-index-cache-{}-{}",
            std::process::id(),
            name
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("pages")).unwrap();
        fs::create_dir_all(root.join("journals")).unwrap();
        Self { root }
    }

    fn write(&self, rel: &str, text: &str) {
        fs::write(self.root.join(rel), text).unwrap();
    }
}

impl Drop for TestGraph {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn serialized(graph: &Graph, name: &str) -> String {
    serialize_page(&graph.pages[name], &graph.blocks)
}

#[test]
fn second_index_restores_complete_graph_from_cache() {
    let fixture = TestGraph::new("roundtrip");
    let source = "title:: Пример\n\n- DOING [#A] Задача\n  key::  value  \n  :LOGBOOK:\n  CLOCK: [2026-01-18 Sun 10:00:00]--[2026-01-18 Sun 11:00:00] =>  1:00:00\n  :END:\n\n\t- дочерний блок\n";
    fixture.write("pages/Пример.md", source);

    let mut first = Graph::default();
    first.index_dir(&fixture.root).unwrap();
    assert!(fixture.root.join(".logtask/index-cache.bin").is_file());

    let mut second = Graph::default();
    second.index_dir(&fixture.root).unwrap();
    assert_eq!(serialized(&second, "Пример"), source);
    assert_eq!(second.pages["Пример"].mtime, first.pages["Пример"].mtime);
    assert_eq!(
        second.pages["Пример"].content_hash,
        first.pages["Пример"].content_hash
    );
    assert_eq!(second.backlinks, first.backlinks);
    assert_eq!(second.block_page, first.block_page);
}

#[test]
fn unchanged_files_use_cached_graph() {
    let fixture = TestGraph::new("cache-hit");
    fixture.write("pages/Пример.md", "- исходный текст\n");

    let mut first = Graph::default();
    let stats = first.index_dir(&fixture.root).unwrap();
    let id = first.pages["Пример"].order[0];
    first.blocks.get_mut(&id).unwrap().content = "маркер из кэша".into();
    logtask_lib::core::index_cache::save(&fixture.root, &first, &stats);

    let mut second = Graph::default();
    second.index_dir(&fixture.root).unwrap();
    assert_eq!(second.blocks[&id].content, "маркер из кэша");
}

#[test]
fn changed_added_and_removed_files_invalidate_cache() {
    let fixture = TestGraph::new("file-changes");
    fixture.write("pages/Первая.md", "- старый текст\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();

    fixture.write("pages/Первая.md", "- новый текст!\n");
    graph.index_dir(&fixture.root).unwrap();
    assert_eq!(serialized(&graph, "Первая"), "- новый текст!\n");

    fixture.write("pages/Вторая.md", "- добавленная\n");
    graph.index_dir(&fixture.root).unwrap();
    assert!(graph.pages.contains_key("Вторая"));

    fs::remove_file(fixture.root.join("pages/Первая.md")).unwrap();
    graph.index_dir(&fixture.root).unwrap();
    assert!(!graph.pages.contains_key("Первая"));
}

#[test]
fn corrupted_cache_falls_back_to_markdown() {
    let fixture = TestGraph::new("corrupted");
    fixture.write("pages/Пример.md", "- из markdown\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();
    fs::write(fixture.root.join(".logtask/index-cache.bin"), b"broken").unwrap();

    graph.index_dir(&fixture.root).unwrap();
    assert_eq!(serialized(&graph, "Пример"), "- из markdown\n");
}

#[test]
fn unsupported_cache_version_falls_back_to_markdown() {
    let fixture = TestGraph::new("version");
    fixture.write("pages/Пример.md", "- из markdown\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();
    let path = fixture.root.join(".logtask/index-cache.bin");
    let mut bytes = fs::read(&path).unwrap();
    bytes[..4].copy_from_slice(&u32::MAX.to_le_bytes());
    fs::write(path, bytes).unwrap();

    graph.index_dir(&fixture.root).unwrap();
    assert_eq!(serialized(&graph, "Пример"), "- из markdown\n");
}

#[test]
fn non_markdown_and_invalid_journals_do_not_invalidate_cache() {
    let fixture = TestGraph::new("ignored-files");
    fixture.write("pages/Пример.md", "- исходный текст\n");
    fixture.write("pages/заметка.txt", "не индексируется");
    fixture.write("journals/не-дата.md", "- не индексируется\n");
    let mut first = Graph::default();
    let stats = first.index_dir(&fixture.root).unwrap();
    let id = first.pages["Пример"].order[0];
    first.blocks.get_mut(&id).unwrap().content = "маркер из кэша".into();
    logtask_lib::core::index_cache::save(&fixture.root, &first, &stats);

    fixture.write("pages/заметка.txt", "другой текст");
    fixture.write("journals/не-дата.md", "- другой текст\n");
    let mut second = Graph::default();
    second.index_dir(&fixture.root).unwrap();
    assert_eq!(second.blocks[&id].content, "маркер из кэша");
    assert!(!second.pages.contains_key("не-дата"));
}

#[test]
fn cache_write_failure_does_not_prevent_indexing() {
    let fixture = TestGraph::new("unwritable");
    fixture.write("pages/Пример.md", "- из markdown\n");
    fixture.write(".logtask", "не каталог");

    let mut graph = Graph::default();
    let stats = graph.index_dir(&fixture.root).unwrap();
    assert_eq!(stats.blocks, 1);
    assert_eq!(serialized(&graph, "Пример"), "- из markdown\n");
}

#[test]
fn valid_bincode_with_damaged_payload_falls_back_to_markdown() {
    let fixture = TestGraph::new("checksum");
    fixture.write("pages/Пример.md", "- из markdown\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();
    let path = fixture.root.join(".logtask/index-cache.bin");
    let mut bytes = fs::read(&path).unwrap();
    let needle = "markdown".as_bytes();
    let position = bytes
        .windows(needle.len())
        .position(|window| window == needle)
        .unwrap();
    bytes[position] = b'X';
    fs::write(path, bytes).unwrap();

    graph.index_dir(&fixture.root).unwrap();
    assert_eq!(serialized(&graph, "Пример"), "- из markdown\n");
}

#[test]
fn unreadable_markdown_is_not_cached_as_missing_page() {
    let fixture = TestGraph::new("read-error");
    fs::write(fixture.root.join("pages/Битая.md"), [0xff, 0xfe, 0xfd]).unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();
    assert!(!graph.pages.contains_key("Битая"));
    assert!(!fixture.root.join(".logtask/index-cache.bin").exists());
}
