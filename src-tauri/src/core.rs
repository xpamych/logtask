//! ядро Logtask: парсер outliner, модель, индекс, query (см. docs/)

pub mod fswrite;
pub mod index;
pub mod model;
pub mod parser;
pub mod query;
pub mod serializer;

pub fn core_smoke() -> &'static str {
    "logtask-core"
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::Status;
    use parser::parse_document;
    use serializer::roundtrip;

    #[test]
    fn smoke() {
        assert_eq!(core_smoke(), "logtask-core");
    }

    #[test]
    fn parses_simple_task() {
        let doc = parse_document("- DONE [#A] Купить хлеб\n");
        assert_eq!(doc.blocks.len(), 1);
        let b = &doc.blocks[0];
        assert_eq!(b.status, Some(Status::Done));
        assert_eq!(b.content, "Купить хлеб");
        assert_eq!(b.priority, Some(model::Priority::A));
        assert!(b.is_task());
    }

    #[test]
    fn parses_nesting_and_logbook() {
        let text = "- DOING [#B] Вебхук в Gitea\n  :LOGBOOK:\n  CLOCK: [2026-09-11 Fri 16:17:05]--[2026-09-16 Wed 14:47:53] =>  118:30:48\n  :END:\n\t- подзадача\n";
        let doc = parse_document(text);
        assert_eq!(doc.blocks.len(), 2);
        let parent = &doc.blocks[0];
        assert_eq!(parent.status, Some(Status::Doing));
        assert_eq!(parent.logbook.len(), 1);
        assert!(parent.is_task());
        let child = &doc.blocks[1];
        assert_eq!(child.indent, 1);
        assert_eq!(child.parent, parent.id);
        assert_eq!(parent.children.len(), 1);
    }

    #[test]
    fn parses_props_and_links() {
        let text = "- TODO [#C] #feature #ppdb Задача [[PPDB - TODO]]\n  source-id:: ppdb-225\n";
        let doc = parse_document(text);
        let b = &doc.blocks[0];
        assert_eq!(b.props.get("source-id"), Some(&"ppdb-225".to_string()));
        assert!(b.links.iter().any(|l| matches!(
            l,
            model::LinkTarget::Page(n) if n == "PPDB - TODO"
        )));
        assert!(b.links.iter().any(|l| matches!(
            l,
            model::LinkTarget::Tag(n) if n == "feature"
        )));
    }

    #[test]
    fn roundtrip_simple() {
        let text = "- DONE [#B] Задача\n- TODO [#A] Другая\n";
        assert_eq!(roundtrip(text), text);
    }

    #[test]
    fn roundtrip_logbook_and_props() {
        let text = "- DOING [#B] Вебхук\n  source-id:: ppdb-225\n  :LOGBOOK:\n  CLOCK: [2026-09-11 Fri 16:17:05]--[2026-09-16 Wed 14:47:53] =>  118:30:48\n  :END:\n";
        assert_eq!(roundtrip(text), text);
    }
}
