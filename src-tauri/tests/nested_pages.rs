use std::fs;
use std::path::{Path, PathBuf};

use logtask_lib::core::model::Graph;
use logtask_lib::core::page_names::{
    canonical_page_name, graph_name, local_page_name, resolve_local_page_name,
    stored_page_name,
};

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir()
            .join(format!("logtask-nested-{}-{}", std::process::id(), name))
            .join("Заметки");
        let _ = fs::remove_dir_all(root.parent().unwrap());
        fs::create_dir_all(root.join("pages")).unwrap();
        Self { root }
    }

    fn write(&self, rel: &str, text: &str) {
        let path = self.root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.root.parent().unwrap());
    }
}

#[test]
fn indexes_nested_pages_with_relative_names() {
    let fixture = Fixture::new("recursive");
    fixture.write("pages/A.md", "- [[Заметки/Dir/B]] и #[[Заметки/Dir/B]]\n");
    fixture.write("pages/Dir/B.md", "- B\n");
    fixture.write("pages/Dir/Deep/C.md", "- C\n");
    fixture.write("pages/Other/B.md", "- другая B\n");

    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();

    assert_eq!(graph.pages.len(), 4);
    assert!(graph.pages.contains_key("A"));
    assert!(graph.pages.contains_key("Dir/B"));
    assert!(graph.pages.contains_key("Dir/Deep/C"));
    assert!(graph.pages.contains_key("Other/B"));
    assert_eq!(
        graph.pages["Dir/Deep/C"].path.as_deref(),
        Some(Path::new("pages/Dir/Deep/C.md"))
    );
    assert_eq!(graph.backlinks_of("Dir/B").len(), 2);
    assert_eq!(graph.backlinks_of("Other/B").len(), 0);
}

#[test]
fn creates_nested_pages_and_lists_empty_directories() {
    let fixture = Fixture::new("create");
    Graph::create_page_file("Dir/New", &fixture.root).unwrap();
    Graph::create_page_directory("Dir/Empty", &fixture.root).unwrap();
    Graph::create_page_directory("Dir/Empty", &fixture.root).unwrap();

    assert!(fixture.root.join("pages/Dir/New.md").is_file());
    assert_eq!(
        Graph::page_directories(&fixture.root).unwrap(),
        vec!["Dir".to_string(), "Dir/Empty".to_string()]
    );

    for invalid in ["/tmp/x", "../x", "a//b", "a\\b", "a/./b"] {
        assert!(Graph::create_page_file(invalid, &fixture.root).is_err(), "{invalid}");
        assert!(Graph::create_page_directory(invalid, &fixture.root).is_err(), "{invalid}");
    }
}

#[cfg(unix)]
#[test]
fn indexing_does_not_follow_directory_symlinks() {
    let fixture = Fixture::new("symlink");
    fixture.write("pages/Local.md", "- local\n");
    fixture.write("outside/External.md", "- external\n");
    std::os::unix::fs::symlink(
        fixture.root.join("outside"),
        fixture.root.join("pages/Linked"),
    )
    .unwrap();

    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();
    assert!(graph.pages.contains_key("Local"));
    assert!(!graph.pages.contains_key("Linked/External"));

    std::os::unix::fs::symlink(
        fixture.root.join("outside"),
        fixture.root.join("pages/WriteLink"),
    )
    .unwrap();
    assert!(Graph::create_page_file("WriteLink/Escape", &fixture.root).is_err());
    assert!(Graph::create_page_directory("WriteLink/Child", &fixture.root).is_err());
    assert!(!fixture.root.join("outside/Escape.md").exists());
    assert!(!fixture.root.join("outside/Child").exists());
}

#[test]
fn canonical_names_include_graph_basename() {
    let fixture = Fixture::new("names");
    assert_eq!(graph_name(&fixture.root).unwrap(), "Заметки");
    assert_eq!(
        canonical_page_name(&fixture.root, "Dir/B").unwrap(),
        "Заметки/Dir/B"
    );
    assert_eq!(
        local_page_name(&fixture.root, "Заметки/Dir/B"),
        Some("Dir/B".into())
    );
    assert_eq!(
        local_page_name(&fixture.root, "Dir/B"),
        Some("Dir/B".into())
    );
}

#[test]
fn stored_names_become_canonical_without_guessing_missing_pages() {
    let fixture = Fixture::new("stored");
    fixture.write("pages/A.md", "- A\n");
    fixture.write("pages/Repo/B.md", "- B\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();

    assert_eq!(stored_page_name(&graph, &fixture.root, "A", false), "Заметки/A");
    assert_eq!(stored_page_name(&graph, &fixture.root, "Заметки/A", false), "Заметки/A");
    assert_eq!(stored_page_name(&graph, &fixture.root, "Missing", false), "Missing");
    assert_eq!(stored_page_name(&graph, &fixture.root, "Repo/", true), "Заметки/Repo/");
}

#[test]
fn resolver_prefers_existing_local_path() {
    let fixture = Fixture::new("resolver");
    fixture.write("pages/Dir/B.md", "- local\n");
    fixture.write("pages/Other/B.md", "- other\n");
    let mut graph = Graph::default();
    graph.index_dir(&fixture.root).unwrap();

    assert_eq!(
        resolve_local_page_name(&graph, &fixture.root, "Заметки/Dir/B"),
        Some("Dir/B".into())
    );
    assert_eq!(
        resolve_local_page_name(&graph, &fixture.root, "Other/B"),
        Some("Other/B".into())
    );
    assert_eq!(
        resolve_local_page_name(&graph, &fixture.root, "ДругойГраф/Dir/B"),
        None
    );
    assert_eq!(
        resolve_local_page_name(&graph, &fixture.root, "Dir/Missing"),
        None
    );
}
