//! Проекция in-memory графа страниц для визуального представления.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};

use serde::Serialize;

use super::model::{Graph, LinkTarget, PageKind};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeDto {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub path: Option<String>,
    pub tags: Vec<String>,
    pub degree: usize,
    pub asset_path: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeDto {
    pub id: String,
    pub source: String,
    pub target: String,
    pub weight: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSnapshotDto {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
    pub revision: u64,
}

fn page_id(name: &str, kind: PageKind) -> String {
    match kind {
        PageKind::Page => format!("page:{name}"),
        PageKind::Journal => format!("journal:{name}"),
    }
}

impl Graph {
    fn target_node(&self, link: &LinkTarget) -> GraphNodeDto {
        match link {
            LinkTarget::Asset(path) => GraphNodeDto {
                id: format!("asset:{path}"),
                title: std::path::Path::new(path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(path)
                    .to_string(),
                kind: "asset".into(),
                path: Some(path.clone()),
                tags: Vec::new(),
                degree: 0,
                asset_path: Some(path.clone()),
                exists: true,
            },
            LinkTarget::Page(name) | LinkTarget::Tag(name) => {
                if let Some(page) = self.pages.get(name) {
                    GraphNodeDto {
                        id: page_id(name, page.kind),
                        title: name.clone(),
                        kind: match page.kind {
                            PageKind::Page => "page",
                            PageKind::Journal => "journal",
                        }
                        .into(),
                        path: page.path.as_ref().map(|p| p.display().to_string()),
                        tags: Vec::new(),
                        degree: 0,
                        asset_path: None,
                        exists: true,
                    }
                } else {
                    let tag = matches!(link, LinkTarget::Tag(_));
                    GraphNodeDto {
                        id: if tag {
                            format!("tag:{name}")
                        } else {
                            format!("virtual:{name}")
                        },
                        title: name.clone(),
                        kind: if tag { "tag" } else { "virtual" }.into(),
                        path: None,
                        tags: Vec::new(),
                        degree: 0,
                        asset_path: None,
                        exists: false,
                    }
                }
            }
            LinkTarget::Block(_) => unreachable!("блоковые ссылки не попадают в проекцию"),
        }
    }

    pub fn visual_snapshot(&self) -> GraphSnapshotDto {
        let mut nodes: BTreeMap<String, GraphNodeDto> = self
            .pages
            .values()
            .map(|page| {
                let link = LinkTarget::Page(page.name.clone());
                let node = self.target_node(&link);
                (node.id.clone(), node)
            })
            .collect();
        let mut edges: BTreeMap<(String, String), usize> = BTreeMap::new();
        let mut page_tags: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

        for block in self.blocks.values() {
            let Some(source_name) = self.block_page.get(&block.id.unwrap_or_default()) else {
                continue;
            };
            let Some(source_page) = self.pages.get(source_name) else {
                continue;
            };
            let source = page_id(source_name, source_page.kind);
            for link in &block.links {
                if matches!(link, LinkTarget::Block(_)) {
                    continue;
                }
                if let LinkTarget::Tag(name) = link {
                    page_tags
                        .entry(source.clone())
                        .or_default()
                        .insert(name.clone());
                }
                let target = self.target_node(link);
                let target_id = target.id.clone();
                nodes.entry(target_id.clone()).or_insert(target);
                *edges.entry((source.clone(), target_id)).or_default() += 1;
            }
        }
        for (id, tags) in page_tags {
            if let Some(node) = nodes.get_mut(&id) {
                node.tags = tags.into_iter().collect();
            }
        }
        snapshot_from_parts(nodes, edges)
    }

    pub fn shortest_path(
        &self,
        visible_ids: &HashSet<String>,
        from: &str,
        to: &str,
    ) -> Option<Vec<String>> {
        if !visible_ids.contains(from) || !visible_ids.contains(to) {
            return None;
        }
        if from == to {
            return Some(vec![from.to_string()]);
        }
        let snapshot = self.visual_snapshot();
        let mut adjacency: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for edge in &snapshot.edges {
            if visible_ids.contains(&edge.source) && visible_ids.contains(&edge.target) {
                adjacency
                    .entry(&edge.source)
                    .or_default()
                    .insert(&edge.target);
                adjacency
                    .entry(&edge.target)
                    .or_default()
                    .insert(&edge.source);
            }
        }
        let mut queue = VecDeque::from([from]);
        let mut previous: HashMap<&str, &str> = HashMap::new();
        let mut visited = HashSet::from([from]);
        while let Some(current) = queue.pop_front() {
            for next in adjacency.get(current).into_iter().flatten() {
                if !visited.insert(next) {
                    continue;
                }
                previous.insert(next, current);
                if *next == to {
                    let mut path = vec![to.to_string()];
                    let mut cursor = to;
                    while cursor != from {
                        cursor = previous[cursor];
                        path.push(cursor.to_string());
                    }
                    path.reverse();
                    return Some(path);
                }
                queue.push_back(next);
            }
        }
        None
    }

    pub fn local_snapshot(
        &self,
        root: &str,
        depth: u8,
        visible_ids: &HashSet<String>,
    ) -> GraphSnapshotDto {
        let full = self.visual_snapshot();
        let mut adjacency: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for edge in &full.edges {
            adjacency
                .entry(&edge.source)
                .or_default()
                .insert(&edge.target);
            adjacency
                .entry(&edge.target)
                .or_default()
                .insert(&edge.source);
        }
        let mut allowed = HashSet::from([root.to_string()]);
        let mut frontier = BTreeSet::from([root.to_string()]);
        for _ in 0..depth.min(3) {
            let mut next = BTreeSet::new();
            for current in &frontier {
                for neighbor in adjacency.get(current.as_str()).into_iter().flatten() {
                    if visible_ids.contains(*neighbor) && !allowed.contains(*neighbor) {
                        next.insert((*neighbor).to_string());
                    }
                }
            }
            allowed.extend(next.iter().cloned());
            frontier = next;
        }
        let nodes = full
            .nodes
            .into_iter()
            .filter(|node| allowed.contains(&node.id))
            .map(|node| (node.id.clone(), node))
            .collect();
        let edges = full
            .edges
            .into_iter()
            .filter(|edge| allowed.contains(&edge.source) && allowed.contains(&edge.target))
            .map(|edge| ((edge.source, edge.target), edge.weight))
            .collect();
        snapshot_from_parts(nodes, edges)
    }
}

fn snapshot_from_parts(
    nodes: BTreeMap<String, GraphNodeDto>,
    edges: BTreeMap<(String, String), usize>,
) -> GraphSnapshotDto {
    let mut neighbors: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (source, target) in edges.keys() {
        if source != target {
            neighbors
                .entry(source.clone())
                .or_default()
                .insert(target.clone());
            neighbors
                .entry(target.clone())
                .or_default()
                .insert(source.clone());
        }
    }
    let nodes: Vec<GraphNodeDto> = nodes
        .into_values()
        .map(|mut node| {
            node.degree = neighbors.get(&node.id).map_or(0, BTreeSet::len);
            node
        })
        .collect();
    let edges: Vec<GraphEdgeDto> = edges
        .into_iter()
        .map(|((source, target), weight)| GraphEdgeDto {
            id: format!("{source}->{target}"),
            source,
            target,
            weight,
        })
        .collect();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    nodes.hash(&mut hasher);
    edges.hash(&mut hasher);
    GraphSnapshotDto {
        nodes,
        edges,
        revision: hasher.finish(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use crate::core::index::IndexStats;
    use crate::core::model::{Graph, PageKind};

    fn add_page(graph: &mut Graph, name: &str, kind: PageKind, text: &str) {
        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        graph.index_file_content(name, kind, text, None, &mut stats, None);
    }

    fn fixture() -> Graph {
        let mut graph = Graph::default();
        add_page(
            &mut graph,
            "A",
            PageKind::Page,
            "- [[B]] [[B]] [[Ghost]] [[A]] ![[../assets/a.png]]\n",
        );
        add_page(&mut graph, "B", PageKind::Page, "- [[A]] #A\n");
        add_page(&mut graph, "C", PageKind::Page, "- [[B]]\n");
        add_page(&mut graph, "2026_10_26", PageKind::Journal, "- [[A]]\n");
        graph
    }

    #[test]
    fn visual_graph_deduplicates_nodes_and_edges() {
        let snapshot = fixture().visual_snapshot();
        assert_eq!(
            snapshot.nodes.iter().filter(|n| n.id == "page:B").count(),
            1
        );
        assert!(snapshot
            .nodes
            .iter()
            .any(|n| n.id == "virtual:Ghost" && !n.exists));
        assert!(snapshot.nodes.iter().any(|n| n.id == "asset:assets/a.png"));
        assert!(snapshot.nodes.iter().any(|n| n.id == "journal:2026_10_26"));

        let ab = snapshot
            .edges
            .iter()
            .find(|e| e.source == "page:A" && e.target == "page:B")
            .unwrap();
        assert_eq!(ab.weight, 2);
        let ba = snapshot
            .edges
            .iter()
            .find(|e| e.source == "page:B" && e.target == "page:A")
            .unwrap();
        assert_eq!(ba.weight, 2);
        assert_eq!(
            snapshot
                .edges
                .iter()
                .filter(|e| e.source == "page:A" && e.target == "page:B")
                .count(),
            1
        );
    }

    #[test]
    fn visual_graph_degree_counts_unique_neighbors_not_self() {
        let snapshot = fixture().visual_snapshot();
        let a = snapshot.nodes.iter().find(|n| n.id == "page:A").unwrap();
        assert_eq!(a.degree, 4);
        assert_eq!(snapshot.revision, fixture().visual_snapshot().revision);
    }

    #[test]
    fn visual_graph_shortest_path_ignores_direction_and_requires_visible_nodes() {
        let graph = fixture();
        let snapshot = graph.visual_snapshot();
        let visible: HashSet<String> = snapshot.nodes.iter().map(|n| n.id.clone()).collect();
        assert_eq!(
            graph.shortest_path(&visible, "page:A", "page:C"),
            Some(vec!["page:A".into(), "page:B".into(), "page:C".into()])
        );
        let without_b: HashSet<String> = visible
            .iter()
            .filter(|id| *id != "page:B")
            .cloned()
            .collect();
        assert_eq!(graph.shortest_path(&without_b, "page:A", "page:C"), None);
    }

    #[test]
    fn visual_graph_local_respects_depth() {
        let graph = fixture();
        let snapshot = graph.visual_snapshot();
        let visible: HashSet<String> = snapshot.nodes.iter().map(|n| n.id.clone()).collect();
        let depth1 = graph.local_snapshot("page:A", 1, &visible);
        assert!(depth1.nodes.iter().any(|n| n.id == "page:A"));
        assert!(depth1.nodes.iter().any(|n| n.id == "page:B"));
        assert!(!depth1.nodes.iter().any(|n| n.id == "page:C"));
        let depth2 = graph.local_snapshot("page:A", 2, &visible);
        assert!(depth2.nodes.iter().any(|n| n.id == "page:C"));
    }
}
