use std::{fs, path::PathBuf};
use logtask_lib::core::{block_batch::BatchOperation, model::Graph};
use uuid::Uuid;

const PAGE: &str = "2026_11_24";
const SOURCE: &str = "- A\n\t- A1\n  urgency:: high\n- B\n\t- B1\n- C\n- D\n";

fn graph(name: &str) -> (Graph, PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!("logtask_batch_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("journals")).unwrap();
    let file = dir.join("journals/2026_11_24.md");
    fs::write(&file, SOURCE).unwrap();
    let mut graph = Graph::default();
    graph.index_dir(&dir).unwrap();
    (graph, dir, file)
}

fn id(graph: &Graph, text: &str) -> Uuid {
    graph.blocks.iter().find(|(_, block)| block.content == text).map(|(id, _)| *id).unwrap()
}

fn contents(graph: &Graph) -> Vec<&str> {
    graph.pages[PAGE].order.iter().map(|id| graph.blocks[id].content.as_str()).collect()
}

#[test]
fn markdown_normalizes_selected_subtrees_without_writing() {
    let (graph, dir, file) = graph("markdown");
    let before = fs::read_to_string(&file).unwrap();
    let text = graph.blocks_markdown(&[id(&graph, "A"), id(&graph, "A1")]).unwrap();
    assert_eq!(text, "- A\n\t- A1\n\t  urgency:: high\n");
    assert_eq!(fs::read_to_string(file).unwrap(), before);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn delete_deduplicates_nested_selection() {
    let (mut graph, dir, file) = graph("delete");
    let page = graph.apply_block_batch(&[id(&graph, "A1"), id(&graph, "A"), id(&graph, "C")], BatchOperation::Delete, &dir).unwrap();
    assert_eq!(page.as_deref(), Some(PAGE));
    assert_eq!(fs::read_to_string(file).unwrap(), "- B\n\t- B1\n- D\n");
    assert_eq!(contents(&graph), ["B", "B1", "D"]);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn move_preserves_order_and_subtrees() {
    let (mut graph, dir, file) = graph("move");
    graph.apply_block_batch(&[id(&graph, "A"), id(&graph, "B")], BatchOperation::Move { direction: 1 }, &dir).unwrap();
    assert_eq!(fs::read_to_string(file).unwrap(), "- C\n- A\n\t- A1\n  urgency:: high\n- B\n\t- B1\n- D\n");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn indent_and_outdent_include_children() {
    let (mut graph, dir, file) = graph("indent");
    graph.apply_block_batch(&[id(&graph, "B"), id(&graph, "C")], BatchOperation::Indent { direction: 1 }, &dir).unwrap();
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("- A\n\t- A1\n  urgency:: high\n\t- B\n\t\t- B1\n\t- C\n- D"), "{text}");
    let b = id(&graph, "B");
    graph.apply_block_batch(&[b], BatchOperation::Indent { direction: -1 }, &dir).unwrap();
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("\t- C\n- B\n\t- B1\n- D"), "{text}");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn invalid_input_and_boundary_do_not_write() {
    let (mut graph, dir, file) = graph("invalid");
    assert!(graph.apply_block_batch(&[], BatchOperation::Delete, &dir).is_err());
    assert!(graph.apply_block_batch(&[Uuid::now_v7()], BatchOperation::Delete, &dir).is_err());
    assert!(graph.apply_block_batch(&[id(&graph, "A")], BatchOperation::Move { direction: 0 }, &dir).is_err());
    let before = fs::read_to_string(&file).unwrap();
    assert_eq!(graph.apply_block_batch(&[id(&graph, "A")], BatchOperation::Move { direction: -1 }, &dir).unwrap(), None);
    assert_eq!(fs::read_to_string(file).unwrap(), before);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn mixed_pages_and_external_edit_are_atomic() {
    let (mut graph, dir, file) = graph("atomic");
    fs::create_dir_all(dir.join("pages")).unwrap();
    fs::write(dir.join("pages/other.md"), "- other\n").unwrap();
    graph.index_dir(&dir).unwrap();
    assert!(graph.apply_block_batch(&[id(&graph, "A"), id(&graph, "other")], BatchOperation::Delete, &dir).is_err());
    assert_eq!(fs::read_to_string(&file).unwrap(), SOURCE);
    std::thread::sleep(std::time::Duration::from_millis(10));
    fs::write(&file, "- external\n").unwrap();
    assert!(graph.apply_block_batch(&[id(&graph, "A")], BatchOperation::Delete, &dir).is_err());
    assert_eq!(fs::read_to_string(file).unwrap(), "- external\n");
    assert!(contents(&graph).contains(&"A"));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn duplicate_ids_are_rejected_without_mutation() {
    let (mut graph, dir, file) = graph("duplicates");
    let a = id(&graph, "A");
    assert!(graph.apply_block_batch(&[a, a], BatchOperation::Delete, &dir).is_err());
    assert!(graph.blocks_markdown(&[a, a]).is_err());
    assert_eq!(fs::read_to_string(file).unwrap(), SOURCE);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn partially_valid_group_operations_are_noop() {
    for (name, operation, first, second) in [
        ("move_up", BatchOperation::Move { direction: -1 }, "A", "B"),
        ("move_down", BatchOperation::Move { direction: 1 }, "C", "D"),
        ("indent", BatchOperation::Indent { direction: 1 }, "A", "B"),
        ("outdent", BatchOperation::Indent { direction: -1 }, "A", "B"),
    ] {
        let (mut graph, dir, file) = graph(name);
        let result = graph.apply_block_batch(&[id(&graph, first), id(&graph, second)], operation, &dir).unwrap();
        assert_eq!(result, None, "{name}");
        assert_eq!(fs::read_to_string(&file).unwrap(), SOURCE, "{name}");
        let _ = fs::remove_dir_all(dir);
    }
}
