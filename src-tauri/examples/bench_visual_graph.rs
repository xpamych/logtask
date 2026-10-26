use std::collections::HashSet;
use std::time::Instant;

use logtask_lib::core::index::IndexStats;
use logtask_lib::core::model::{Graph, PageKind};

fn synthetic(nodes: usize, edges: usize) -> Graph {
    let mut graph = Graph::default();
    for index in 0..nodes {
        let mut links = Vec::new();
        if edges > 0 {
            links.push((index + 1) % nodes);
        }
        if edges > 1 {
            links.push((index + 2) % nodes);
        }
        if edges > 2 && index < edges - 2 * nodes {
            links.push((index + 3) % nodes);
        }
        let text = links
            .into_iter()
            .map(|target| format!("[[P{target:05}]]"))
            .collect::<Vec<_>>()
            .join(" ");
        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        graph.index_file_content(
            &format!("P{index:05}"),
            PageKind::Page,
            &format!("- {text}\n"),
            None,
            &mut stats,
            None,
        );
    }
    graph
}

fn main() {
    for (nodes, edges) in [
        (1_000, 2_500),
        (3_000, 7_500),
        (5_000, 12_500),
        (10_000, 25_000),
    ] {
        let graph = synthetic(nodes, edges);
        let started = Instant::now();
        let snapshot = graph.visual_snapshot();
        assert_eq!(snapshot.nodes.len(), nodes);
        assert_eq!(snapshot.edges.len(), edges);
        let visible: HashSet<String> = snapshot.nodes.iter().map(|node| node.id.clone()).collect();
        let path = graph.shortest_path(&visible, "page:P00000", &format!("page:P{:05}", nodes - 1));
        assert!(path.is_some());
        println!(
            "{nodes} узлов / {edges} рёбер: проекция + BFS {:?}, revision {}",
            started.elapsed(),
            snapshot.revision
        );
    }
}
