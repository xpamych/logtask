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
        let text = "- TODO [#C] #feature #demo Задача [[Пример - TODO]]\n  source-id:: demo-225\n";
        let doc = parse_document(text);
        let b = &doc.blocks[0];
        assert_eq!(b.props.get("source-id"), Some(&"demo-225".to_string()));
        assert!(b.links.iter().any(|l| matches!(
            l,
            model::LinkTarget::Page(n) if n == "Пример - TODO"
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
    fn priority_without_status_is_task() {
        let parsed = parse_document("- [#A] приоритет без статуса\n");
        let b = &parsed.blocks[0];
        assert_eq!(b.priority, Some(model::Priority::A));
        assert_eq!(b.content, "приоритет без статуса");
        assert!(b.is_task());
    }

    #[test]
    fn roundtrip_priority_without_status() {
        let text = "- [#A] задача без статуса\n- [#C] другая\n";
        assert_eq!(roundtrip(text), text);
    }

    #[test]
    fn set_content_reparses_priority_change() {
        let mut doc = parse_document("- TODO [#B] старый текст\n");
        let b = &mut doc.blocks[0];
        b.set_content("[#A] новый текст");
        assert_eq!(b.priority, Some(model::Priority::A));
        assert_eq!(b.content, "новый текст");
        assert_eq!(b.raw.marker_str, "TODO [#A] ");
    }

    #[test]
    fn set_content_reparses_priority_removed() {
        let mut doc = parse_document("- TODO [#B] старый текст\n");
        let b = &mut doc.blocks[0];
        b.set_content("просто текст");
        assert_eq!(b.priority, None);
        assert_eq!(b.content, "просто текст");
        assert_eq!(b.raw.marker_str, "TODO ");
    }

    #[test]
    fn set_content_reparses_priority_added() {
        let mut doc = parse_document("- заметка\n");
        let b = &mut doc.blocks[0];
        b.set_content("[#C] заметка");
        assert_eq!(b.priority, Some(model::Priority::C));
        assert_eq!(b.content, "заметка");
        assert_eq!(b.raw.marker_str, "[#C] ");
    }

    #[test]
    fn set_content_invalid_priority_stays_text() {
        let mut doc = parse_document("- TODO [#B] старый текст\n");
        let b = &mut doc.blocks[0];
        b.set_content("[#Q] текст");
        assert_eq!(b.priority, None);
        assert_eq!(b.content, "[#Q] текст");
        assert_eq!(b.raw.marker_str, "TODO ");
    }

    #[test]
    fn edit_source_full_block() {
        // блок со свойством, логбуком и сырыми строками (код с отступами)
        let text = "- DOING [#B] Задача\n  urgency:: high\n  :LOGBOOK:\n  CLOCK: [2026-09-11 Fri 16:17:05]--[2026-09-16 Wed 14:47:53] =>  118:30:48\n  :END:\n  ```text\n      глубокая строка\n  ```\n";
        let doc = parse_document(text);
        let b = &doc.blocks[0];
        let src = b.edit_source();
        assert_eq!(
            src,
            "[#B] Задача\nurgency:: high\n:LOGBOOK:\nCLOCK: [2026-09-11 Fri 16:17:05]--[2026-09-16 Wed 14:47:53] =>  118:30:48\n:END:\n```text\n    глубокая строка\n```"
        );
        // неприкосновенное сохранение возвращает те же байты
        let mut doc2 = parse_document(text);
        doc2.blocks[0].set_source(&src);
        assert_eq!(doc2.blocks[0].to_markdown(), text);
    }

    #[test]
    fn set_source_edits_continuation() {
        let text = "- TODO заметка\n  ```text\n  line1\n  line2\n  ```\n";
        let mut doc = parse_document(text);
        let b = &mut doc.blocks[0];
        b.set_source("заметка\n```text\nline1\nline2 changed\n```");
        assert_eq!(b.content, "заметка");
        assert_eq!(
            b.to_markdown(),
            "- TODO заметка\n  ```text\n  line1\n  line2 changed\n  ```\n"
        );
    }

    #[test]
    fn set_source_preserves_trailing_blank() {
        // пустая строка-разделитель блоков не должна теряться при сохранении
        let mut doc = parse_document("- первая\n\n- вторая\n");
        let b = &mut doc.blocks[0];
        assert_eq!(b.edit_source(), "первая");
        b.set_source("первая изменена");
        assert_eq!(b.to_markdown(), "- первая изменена\n\n");
    }

    #[test]
    fn set_source_updates_props() {
        let mut doc = parse_document("- TODO задача\n  urgency:: high\n");
        let b = &mut doc.blocks[0];
        assert_eq!(b.urgency, Some(model::Level::High));
        // удалили строку свойства в редакторе — свойство исчезло
        b.set_source("задача");
        assert_eq!(b.props.get("urgency"), None);
        assert_eq!(b.urgency, None);
        assert_eq!(b.to_markdown(), "- TODO задача\n");
    }

    #[test]
    fn deadline_soon_uses_real_dates() {
        // сегодня — срочно; просроченный — срочно; далёкое будущее — нет
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert!(model::deadline_is_soon(&today, 3));
        assert!(model::deadline_is_soon("1970-01-01", 3)); // просрочен давно
        assert!(!model::deadline_is_soon("2999-01-01", 3));
    }

    #[test]
    fn links_skip_inline_code() {
        let links = parser::extract_links("`[[НеСсылка]]` и [[Ссылка]]");
        assert_eq!(links, vec![model::LinkTarget::Page("Ссылка".into())]);
    }

    #[test]
    fn tag_stops_at_punctuation() {
        let links = parser::extract_links("сделать #срочно, потом #дом.");
        assert_eq!(
            links,
            vec![
                model::LinkTarget::Tag("срочно".into()),
                model::LinkTarget::Tag("дом".into())
            ]
        );
    }

    #[test]
    fn block_ref_parsed() {
        let links = parser::extract_links("см. ((64f0a1b2-0000-4000-8000-000000000000))");
        assert_eq!(
            links,
            vec![model::LinkTarget::Block(
                "64f0a1b2-0000-4000-8000-000000000000".into()
            )]
        );
    }

    #[test]
    fn search_cyrillic_case_insensitive() {
        // индексируем страницу с блоком "Проект Альфа", ищем "проект" и "ПРОЕКТ"
        let mut g = model::Graph::default();
        let mut stats = index::IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        g.index_file_content(
            "тест",
            model::PageKind::Page,
            "- Проект Альфа\n",
            None,
            &mut stats,
            None,
        );
        assert_eq!(g.search("проект", 10).len(), 1);
        assert_eq!(g.search("ПРОЕКТ", 10).len(), 1);
    }

    #[test]
    fn org_timestamp_before_epoch() {
        // отрицательные секунды не должны паниковать на индексе дня недели
        assert_eq!(model::org_timestamp(-86400), "1969-12-31 Wed 00:00:00");
        assert_eq!(model::org_timestamp(0), "1970-01-01 Thu 00:00:00");
        // days % 7 = -5: старая формула давала отрицательный индекс → panic
        assert_eq!(model::org_timestamp(-5 * 86400), "1969-12-27 Sat 00:00:00");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_permissions_and_leaves_no_tmp() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join("logtask_atomic_write_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("страница.md");
        std::fs::write(&file, "старое\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();

        fswrite::atomic_write(&file, "новое\n").unwrap();

        assert_eq!(std::fs::read_to_string(&file).unwrap(), "новое\n");
        // rename подменяет файл — права исходника должны сохраниться
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755, "права файла должны сохраниться");
        // tmp-файлов в директории не осталось
        let tmps: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".logtask.tmp"))
            .collect();
        assert!(tmps.is_empty(), "tmp-мусор: {tmps:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundtrip_logbook_and_props() {
        let text = "- DOING [#B] Вебхук\n  source-id:: demo-225\n  :LOGBOOK:\n  CLOCK: [2026-09-11 Fri 16:17:05]--[2026-09-16 Wed 14:47:53] =>  118:30:48\n  :END:\n";
        assert_eq!(roundtrip(text), text);
    }
}
