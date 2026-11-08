use std::collections::HashMap;

use uuid::Uuid;

use super::model::{Block, Graph};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockRefTarget {
    pub persisted_id: String,
    pub block_id: Uuid,
    pub page: String,
    pub text: String,
}

impl Graph {
    fn block_ref_candidates(&self) -> Vec<(&Block, String)> {
        let mut pages: Vec<_> = self.pages.values().collect();
        pages.sort_by(|a, b| a.name.cmp(&b.name));
        let mut candidates = Vec::new();
        for page in pages {
            for id in &page.order {
                if let Some(block) = self.blocks.get(id) {
                    candidates.push((block, page.name.clone()));
                }
            }
        }
        candidates
    }

    pub fn resolve_block_refs(&self, uuids: &[String]) -> Vec<Option<BlockRefTarget>> {
        let mut targets = HashMap::new();
        for (block, page) in self.block_ref_candidates() {
            let Some(raw_id) = block.props.get("id") else {
                continue;
            };
            let Ok(id) = Uuid::parse_str(raw_id) else {
                continue;
            };
            targets
                .entry(id.to_string())
                .or_insert_with(|| BlockRefTarget {
                    persisted_id: id.to_string(),
                    block_id: block.id.expect("блок в графе имеет UUID"),
                    page,
                    text: block_ref_text(block),
                });
        }
        uuids
            .iter()
            .map(|raw| {
                Uuid::parse_str(raw)
                    .ok()
                    .and_then(|id| targets.get(&id.to_string()).cloned())
            })
            .collect()
    }

    pub fn search_block_refs(&self, query: &str, limit: usize) -> Vec<BlockRefTarget> {
        let query = query.trim().to_lowercase();
        if query.is_empty() || limit == 0 {
            return Vec::new();
        }
        self.block_ref_candidates()
            .into_iter()
            .filter(|(block, _)| block_ref_text(block).to_lowercase().contains(&query))
            .take(limit)
            .map(|(block, page)| BlockRefTarget {
                persisted_id: block.props.get("id").cloned().unwrap_or_default(),
                block_id: block.id.expect("блок в графе имеет UUID"),
                page,
                text: block_ref_text(block),
            })
            .collect()
    }
}

fn block_ref_text(block: &Block) -> String {
    block
        .content
        .trim()
        .lines()
        .map(str::trim)
        .chain(block.raw.trailing.iter().filter_map(|line| match line {
            super::model::Trailing::Raw { text, .. } => Some(text.trim()),
            _ => None,
        }))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use crate::core::index::IndexStats;
    use crate::core::model::{Graph, PageKind};

    const A: &str = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a812";
    const B: &str = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a813";
    const UNKNOWN: &str = "019a2f10-7c3e-7c21-9f4a-3fd6c6e1a899";

    fn graph() -> Graph {
        let mut graph = Graph::default();
        for (name, text) in [
            (
                "b",
                &format!("- Второй РЕЛИЗ\n  id:: {B}\n- Дубликат\n  id:: {A}\n")[..],
            ),
            (
                "a",
                &format!(
                    "- Первая строка\n  продолжение РЕЛИЗА\n  id:: {A}\n- Ещё релиз\n  id:: {B}\n"
                )[..],
            ),
        ] {
            graph.index_file_content(
                name,
                PageKind::Page,
                text,
                None,
                &mut IndexStats {
                    pages: 0,
                    journals: 0,
                    blocks: 0,
                    tasks: 0,
                    links: 0,
                },
                None,
            );
        }
        graph
    }

    #[test]
    fn resolves_persisted_ids_in_input_order() {
        let graph = graph();
        let expected_block = graph.pages["a"].order[0];
        let result = graph.resolve_block_refs(&[
            A.to_string(),
            UNKNOWN.to_string(),
            A.to_string(),
            "не uuid".to_string(),
        ]);

        assert_eq!(result.len(), 4);
        let first = result[0].as_ref().unwrap();
        assert_eq!(first.persisted_id, A);
        assert_eq!(first.block_id, expected_block);
        assert_eq!(first.page, "a");
        assert_eq!(first.text, "Первая строка продолжение РЕЛИЗА");
        assert!(result[1].is_none());
        assert_eq!(result[2].as_ref().unwrap().block_id, expected_block);
        assert!(result[3].is_none());
    }

    #[test]
    fn duplicate_persisted_ids_choose_first_page_and_block() {
        let graph = graph();
        let result = graph.resolve_block_refs(&[A.to_string()]);
        assert_eq!(result[0].as_ref().unwrap().page, "a");
        assert_eq!(
            result[0].as_ref().unwrap().block_id,
            graph.pages["a"].order[0]
        );
        assert_eq!(graph.blocks.len(), 4);
    }

    #[test]
    fn search_is_case_insensitive_deterministic_and_limited() {
        let graph = graph();
        let result = graph.search_block_refs("релиз", 6);
        let pages: Vec<_> = result.iter().map(|hit| hit.page.as_str()).collect();
        assert_eq!(pages, ["a", "a", "b"]);

        let limited = graph.search_block_refs("релиз", 2);
        assert_eq!(limited.len(), 2);
        assert!(graph.search_block_refs(" ", 6).is_empty());
        assert!(graph.search_block_refs("релиз", 0).is_empty());
    }
}
