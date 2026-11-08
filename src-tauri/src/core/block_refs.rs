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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsuredBlockRef {
    pub persisted_id: String,
    pub page: String,
    pub position: usize,
    pub changed: bool,
}

impl Graph {
    pub fn ensure_block_ref(
        &mut self,
        root: &std::path::Path,
        block_id: Uuid,
    ) -> Result<EnsuredBlockRef, String> {
        let block = self.blocks.get(&block_id).ok_or("блок не найден")?;
        let page = self.page_of_block(&block_id);
        let position = self
            .pages
            .get(&page)
            .and_then(|p| p.order.iter().position(|id| *id == block_id))
            .ok_or("блок не найден на странице")?;
        if let Some(raw_id) = block.props.get("id") {
            let id = Uuid::parse_str(raw_id)
                .map_err(|_| "существующий id:: блока не является UUID".to_string())?;
            return Ok(EnsuredBlockRef {
                persisted_id: id.to_string(),
                page,
                position,
                changed: false,
            });
        }

        let persisted_id = Uuid::now_v7().to_string();
        let id_for_write = persisted_id.clone();
        self.mutate_block(&block_id, root, |block| {
            block.set_prop("id", Some(&id_for_write));
        })
        .map_err(|error| format!("ошибка записи: {error}"))?
        .ok_or("блок не найден")?;
        Ok(EnsuredBlockRef {
            persisted_id,
            page,
            position,
            changed: true,
        })
    }

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

    fn disk_graph(name: &str, text: &str) -> (std::path::PathBuf, Graph) {
        let dir =
            std::env::temp_dir().join(format!("logtask_block_refs_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("pages")).unwrap();
        std::fs::write(dir.join("pages/test.md"), text).unwrap();
        let mut graph = Graph::default();
        graph.index_dir(&dir).unwrap();
        (dir, graph)
    }

    #[test]
    fn ensure_adds_persistent_id_before_logbook() {
        let (dir, mut graph) = disk_graph(
            "add",
            "- TODO задача\n  :LOGBOOK:\n  CLOCK: [2026-01-01 Thu 10:00:00]\n  :END:\n- сосед\n",
        );
        let id = graph.pages["test"].order[0];
        let ensured = graph.ensure_block_ref(&dir, id).unwrap();

        assert!(ensured.changed);
        assert_eq!(ensured.page, "test");
        assert_eq!(ensured.position, 0);
        uuid::Uuid::parse_str(&ensured.persisted_id).unwrap();
        let text = std::fs::read_to_string(dir.join("pages/test.md")).unwrap();
        assert!(text.contains(&format!("\n  id:: {}\n  :LOGBOOK:", ensured.persisted_id)));
        assert!(text.ends_with("  :END:\n- сосед\n"));
        graph.index_dir(&dir).unwrap();
        let resolved = graph.resolve_block_refs(&[ensured.persisted_id]);
        assert_eq!(resolved[0].as_ref().unwrap().text, "задача");
    }

    #[test]
    fn ensure_existing_id_does_not_rewrite_file() {
        let source = format!("- блок\n  id:: {A}\n");
        let (dir, mut graph) = disk_graph("existing", &source);
        let file = dir.join("pages/test.md");
        let mtime = std::fs::metadata(&file).unwrap().modified().unwrap();
        let id = graph.pages["test"].order[0];
        let ensured = graph.ensure_block_ref(&dir, id).unwrap();

        assert!(!ensured.changed);
        assert_eq!(ensured.persisted_id, A);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), source);
        assert_eq!(std::fs::metadata(&file).unwrap().modified().unwrap(), mtime);
    }

    #[test]
    fn ensure_rejects_invalid_existing_id() {
        let source = "- блок\n  id:: не uuid\n";
        let (dir, mut graph) = disk_graph("invalid", source);
        let id = graph.pages["test"].order[0];
        assert!(graph.ensure_block_ref(&dir, id).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("pages/test.md")).unwrap(),
            source
        );
    }
}
