//! Сериализация блоков обратно в Logseq-совместимый markdown.
//! Round-trip: parse → serialize должен давать исходный текст для
//! реальных файлов (см. tests/roundtrip.rs).

use std::collections::HashMap;

use uuid::Uuid;

use super::model::{Block, BlockRaw, Priority, Status, Trailing};

fn write_clock(indent: &str, c: &super::model::Clock, out: &mut String) {
    out.push_str(indent);
    out.push_str("CLOCK: [");
    out.push_str(&c.start);
    out.push(']');
    if let Some(end) = &c.end {
        out.push_str("--[");
        out.push_str(end);
        out.push(']');
    }
    if let Some(d) = &c.duration {
        out.push_str(" =>  ");
        out.push_str(d);
    }
    out.push('\n');
}

impl Block {
    /// Сериализует блок и все его trailing-строки
    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        self.write_markdown(&mut out);
        out
    }

    fn write_markdown(&self, out: &mut String) {
        out.push_str(&self.raw.indent_str);
        out.push_str(&self.raw.bullet);
        out.push_str(&self.raw.marker_str);
        out.push_str(&self.content);
        out.push('\n');

        let mut clock_iter = 0usize;
        let clocks = &self.logbook;
        for item in &self.raw.trailing {
            match item {
                Trailing::Prop { indent, key, value } => {
                    out.push_str(indent);
                    out.push_str(key);
                    out.push_str(":: ");
                    out.push_str(value);
                    out.push('\n');
                }
                Trailing::LogbookStart(indent) => {
                    out.push_str(indent);
                    out.push_str(":LOGBOOK:\n");
                    while clock_iter < clocks.len() {
                        write_clock(indent, &clocks[clock_iter], out);
                        clock_iter += 1;
                    }
                    out.push_str(indent);
                    out.push_str(":END:\n");
                }
                Trailing::LogbookEnd(_) => {}
                Trailing::Raw { indent, text } => {
                    out.push_str(indent);
                    out.push_str(text);
                    out.push('\n');
                }
            }
        }
        // часы вне блока :LOGBOOK: (маловероятно, но не теряем)
        let fallback_indent: &str = self
            .raw
            .trailing
            .first()
            .map(|t| match t {
                Trailing::Prop { indent, .. }
                | Trailing::LogbookStart(indent)
                | Trailing::LogbookEnd(indent)
                | Trailing::Raw { indent, .. } => indent.as_str(),
            })
            .unwrap_or(&self.raw.indent_str);
        while clock_iter < clocks.len() {
            write_clock(fallback_indent, &clocks[clock_iter], out);
            clock_iter += 1;
        }

        for _ in 0..self.raw.blank_after {
            out.push('\n');
        }
    }
}

/// Сериализует блоки документа в markdown (рекурсивно по дереву).
pub fn serialize_document(roots: &[Uuid], blocks: &HashMap<Uuid, Block>) -> String {
    let mut out = String::new();
    for root in roots {
        write_block_tree(root, blocks, &mut out);
    }
    out
}

fn write_block_tree(id: &Uuid, blocks: &HashMap<Uuid, Block>, out: &mut String) {
    let Some(block) = blocks.get(id) else {
        return;
    };
    block.write_markdown(out);
    for child in &block.children {
        write_block_tree(child, blocks, out);
    }
}

/// Удобный тестовый helper: парсит документ и сериализует обратно
pub fn roundtrip(text: &str) -> String {
    let parsed = super::parser::parse_document(text);
    let mut blocks = HashMap::new();
    let mut roots = Vec::new();
    for b in parsed.blocks {
        let id = b.id.expect("свежий uuid");
        if b.parent.is_none() {
            roots.push(id);
        }
        blocks.insert(id, b);
    }
    let mut out = serialize_document(&roots, &blocks);
    for _ in 0..parsed.trailing_blank {
        out.push('\n');
    }
    if !parsed.ends_with_newline && out.ends_with('\n') {
        out.pop();
    }
    out
}

/// Создаёт новый блок с дефолтным форматированием Logseq (tab-отступ)
pub fn new_block(content: String, indent: u8) -> Block {
    let id = Uuid::now_v7();
    let indent_str = "\t".repeat(indent as usize);
    Block {
        id: Some(id),
        indent,
        status: Some(Status::Todo),
        priority: None,
        content,
        props: std::collections::HashMap::new(),
        urgency: None,
        importance: None,
        logbook: Vec::new(),
        links: Vec::new(),
        children: Vec::new(),
        parent: None,
        raw: BlockRaw {
            indent_str,
            bullet: "- ".to_string(),
            marker_str: "TODO ".to_string(),
            trailing: Vec::new(),
            blank_after: 0,
        },
    }
}

/// Префикс для приоритета (для UI-помощников)
pub fn priority_marker(p: Priority) -> &'static str {
    match p {
        Priority::A => "[#A]",
        Priority::B => "[#B]",
        Priority::C => "[#C]",
    }
}
