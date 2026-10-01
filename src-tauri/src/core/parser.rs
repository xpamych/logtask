//! Парсер Logseq-совместимого outliner markdown (см. docs/02-format.md).
//!
//! Поддерживает: bullet-блоки с отступами (tab и 2-пробельные), маркеры
//! статусов, приоритеты [#A..C], свойства `key:: value`, блоки `:LOGBOOK:`
//! с `CLOCK:`-записями, заголовки `##`, сырые параграфы, `[[вики-ссылки]]`
//! и `#теги`. Round-trip: parse → serialize должен возвращать те же байты
//! для реальных файлов (см. tests/roundtrip.rs).

use std::collections::HashMap;

use uuid::Uuid;

use super::model::{
    Block, BlockRaw, Clock, LinkTarget, Page, PageKind, Priority, Status, Trailing,
};

/// "логический" отступ: таб = 1 уровень, 2 пробела =  уровень
pub(crate) fn logical_indent(line: &str) -> u8 {
    let mut level: u8 = 0;
    let mut spaces: u32 = 0;
    for ch in line.chars() {
        match ch {
            '\t' => {
                level += 1;
                spaces = 0;
            }
            ' ' => {
                spaces += 1;
                if spaces == 2 {
                    level += 1;
                    spaces = 0;
                }
            }
            _ => break,
        }
    }
    level
}

/// возвращает (сырой отступ, остаток строки)
fn split_indent(line: &str) -> (&str, &str) {
    let pos = line
        .chars()
        .position(|c| c != ' ' && c != '\t')
        .unwrap_or(line.len());
    line.split_at(pos)
}

/// длина whitespace-префикса
fn ws_len(s: &str) -> usize {
    s.chars().take_while(|c| *c == ' ' || *c == '\t').count()
}

/// Результат разбора строки bullet-блока:
/// (bullet, marker_str, status, priority, content)
/// marker_str — сырой фрагмент "DONE  [#B] " для round-trip
fn parse_bullet_line(rest: &str) -> (String, String, Option<Status>, Option<Priority>, &str) {
    // rest начинается с '-'
    let after_dash = &rest[1..];
    let ws = ws_len(after_dash);
    let bullet = rest[..1 + ws].to_string();
    let s = &after_dash[ws..];

    // маркер: первое слово
    let marker_end = s.find(|c: char| c.is_whitespace()).unwrap_or(s.len());
    let head = &s[..marker_end];
    if let Some(status) = Status::from_marker(head) {
        let after_marker = &s[marker_end..];
        let ws2 = ws_len(after_marker);
        let t = &after_marker[ws2..];

        // приоритет: [#A] сразу после маркера
        if let Some(r) = t.strip_prefix("[#") {
            if let Some(end) = r.find(']') {
                let prio_len = 2 + end + 1;
                let after_prio = &t[prio_len..];
                let ws3 = ws_len(after_prio);
                let priority = match &r[..end] {
                    "A" => Some(Priority::A),
                    "B" => Some(Priority::B),
                    "C" => Some(Priority::C),
                    _ => None,
                };
                if priority.is_some() {
                    let marker_str = s[..marker_end + ws2 + prio_len + ws3].to_string();
                    return (
                        bullet,
                        marker_str,
                        Some(status),
                        priority,
                        &after_prio[ws3..],
                    );
                }
            }
        }

        // маркер без приоритета
        let marker_str = s[..marker_end + ws2].to_string();
        return (bullet, marker_str, Some(status), None, t);
    }

    // приоритет без маркера статуса: "- [#A] текст"
    if let Some(r) = s.strip_prefix("[#") {
        if let Some(end) = r.find(']') {
            let priority = match &r[..end] {
                "A" => Some(Priority::A),
                "B" => Some(Priority::B),
                "C" => Some(Priority::C),
                _ => None,
            };
            if let Some(p) = priority {
                let prio_len = 2 + end + 1;
                let after = &s[prio_len..];
                let ws = ws_len(after);
                let marker_str = s[..prio_len + ws].to_string();
                return (bullet, marker_str, None, Some(p), &after[ws..]);
            }
        }
    }

    // нет маркера — весь остаток контент
    (bullet, String::new(), None, None, s)
}

/// Разбирает строку `key:: value`. Возвращает (key, sep, value), где
/// sep — исходный фрагмент от `::` до начала значения, value — сырое
/// значение после sep (без trim, хвостовые пробелы сохраняются для
/// байт-точного round-trip).
fn parse_prop(rest: &str) -> Option<(String, String, String)> {
    let (key, tail) = rest.split_once("::")?;
    let value_start = tail.len() - tail.trim_start().len();
    let (sp, value) = tail.split_at(value_start);
    Some((key.trim().to_string(), format!("::{sp}"), value.to_string()))
}

fn parse_clock(line: &str) -> Option<Clock> {
    // CLOCK: [2026-01-18 Sun 19:08:08]--[2026-01-19 Mon 17:35:18] =>  22:27:10
    let body = line.trim_start().strip_prefix("CLOCK:")?.trim();
    let (range, duration) = match body.split_once("=>") {
        Some((r, d)) => (r.trim(), Some(d.trim().to_string())),
        None => (body, None),
    };
    let (start, end) = match range.split_once("--") {
        Some((a, b)) => (a.trim().to_string(), Some(b.trim().to_string())),
        None => (range.to_string(), None),
    };
    fn unbracket(s: &str) -> String {
        s.trim_matches(|c| c == '[' || c == ']').to_string()
    }
    Some(Clock {
        start: unbracket(&start),
        end: end.map(|e| unbracket(&e)),
        duration,
    })
}

/// Извлекает [[вики-ссылки]] и #теги из текста блока
pub fn extract_links(content: &str) -> Vec<LinkTarget> {
    let mut links = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' && bytes.get(i + 1) == Some(&b'[') {
            if let Some(end) = content[i + 2..].find("]]") {
                let raw = &content[i + 2..i + 2 + end];
                let name = match raw.split_once('|') {
                    Some((n, _)) => n,
                    None => raw,
                };
                links.push(LinkTarget::Page(name.trim().to_string()));
                i += 2 + end + 2;
                continue;
            }
        }
        if bytes[i] == b'#' {
            // #тег или #[[тег]]
            if bytes.get(i + 1) == Some(&b'[') && bytes.get(i + 2) == Some(&b'[') {
                if let Some(end) = content[i + 3..].find("]]") {
                    let raw = &content[i + 3..i + 3 + end];
                    links.push(LinkTarget::Tag(raw.trim().to_string()));
                    i += 3 + end + 2;
                    continue;
                }
            } else {
                let rest = &content[i + 1..];
                let end = rest
                    .find(|c: char| c.is_whitespace() || matches!(c, '[' | ']' | '#'))
                    .unwrap_or(rest.len());
                if end > 0 {
                    links.push(LinkTarget::Tag(rest[..end].to_string()));
                    i += 1 + end;
                    continue;
                }
            }
        }
        i += 1;
    }
    links
}

/// Одна распарсенная строка файла
enum Line {
    /// начало блока
    Block {
        indent_str: String,
        bullet: String,
        marker_str: String,
        status: Option<Status>,
        priority: Option<Priority>,
        content: String,
    },
    /// `key:: value`
    Prop {
        indent_str: String,
        key: String,
        sep: String,
        value: String,
    },
    LogbookOpen(String),
    LogbookClose(String),
    Clock {
        indent_str: String,
        clock: Clock,
    },
    /// всё остальное (заголовки, параграфы, продолжение контента)
    Raw {
        indent_str: String,
        text: String,
    },
    Empty,
}

fn classify(line: &str) -> Line {
    if line.is_empty() {
        return Line::Empty;
    }
    let (indent_str, rest) = split_indent(line);
    let indent_str = indent_str.to_string();
    let trimmed_end = rest.trim_end();

    if trimmed_end.is_empty() {
        // строка из одних пробелов/tab'ов — значимый whitespace (round-trip)
        return Line::Raw {
            indent_str: String::new(),
            text: line.to_string(),
        };
    }

    if rest.starts_with('-') && rest[1..].chars().all(|c| c == ' ' || c == '\t') {
        // пустой bullet `-   `: весь остаток (с пробелами) — bullet,
        // чтобы round-trip давал те же байты
        return Line::Block {
            indent_str,
            bullet: rest.to_string(),
            marker_str: String::new(),
            status: None,
            priority: None,
            content: String::new(),
        };
    }

    if trimmed_end.starts_with(":LOGBOOK:") {
        return Line::LogbookOpen(indent_str);
    }
    if trimmed_end.starts_with(":END:") {
        return Line::LogbookClose(indent_str);
    }
    if let Some(clock) = parse_clock(trimmed_end) {
        return Line::Clock { indent_str, clock };
    }
    if let Some((key, sep, value)) = parse_prop(rest) {
        if !key.is_empty() && !key.contains(char::is_whitespace) {
            return Line::Prop {
                indent_str,
                key,
                sep,
                value,
            };
        }
    }

    // bullet?
    if trimmed_end.starts_with('-') && trimmed_end.len() > 1 {
        let (bullet, marker_str, status, priority, content) = parse_bullet_line(rest);
        return Line::Block {
            indent_str,
            bullet,
            marker_str,
            status,
            priority,
            content: content.to_string(),
        };
    }

    Line::Raw {
        indent_str,
        text: rest.to_string(),
    }
}

/// Распарсенный документ: преамбула + блоки + хвост из пустых строк
pub struct ParsedFile {
    /// сырые строки до первого блока (page-props, заголовки, пустые)
    pub preamble: Vec<String>,
    pub blocks: Vec<Block>,
    /// пустые строки в самом конце файла
    pub trailing_blank: u16,
    /// оканчивается ли файл переводом строки
    pub ends_with_newline: bool,
}

/// Парсит содержимое .md файла в упорядоченный список блоков.
/// Блоки получают свежие uuid (сохранение `id::` — Фаза 5).
pub fn parse_document(text: &str) -> ParsedFile {
    // отделяем хвост: завершающие переводы строк
    let ends_with_newline = text.ends_with('\n');
    let mut rest = text;
    let mut trailing_blank: u16 = 0;
    while rest.ends_with('\n') {
        trailing_blank += 1;
        rest = &rest[..rest.len() - 1];
    }
    // serialize_page пишет '\n' после последнего блока —
    // это и есть финальный перевод, пустые строки считаем отдельно
    trailing_blank = trailing_blank.saturating_sub(1);

    let mut blocks: Vec<Block> = Vec::new();
    // сырые строки до первого блока (page-props, заголовки, пустые)
    let mut preamble: Vec<String> = Vec::new();
    // стек индексов блоков по уровню отступа для построения parent/children
    let mut stack: Vec<(u8, usize)> = Vec::new();

    let lines: Vec<&str> = rest.split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        // всё до первого bullet-блока уходит в преамбулу как есть
        if blocks.is_empty() && !matches!(classify(line), Line::Block { .. }) {
            preamble.push(line.to_string());
            i += 1;
            continue;
        }
        match classify(line) {
            Line::Empty => {
                // пустые строки до первого блока ушли в преамбулу,
                // поэтому здесь blocks всегда непуст
                if let Some(last) = blocks.last_mut() {
                    last.raw.trailing.push(Trailing::Blank);
                }
                i += 1;
            }
            Line::Block {
                indent_str,
                bullet,
                marker_str,
                status,
                priority,
                content,
            } => {
                let indent = logical_indent(line);
                let id = Uuid::now_v7();
                let links = extract_links(&content);
                let raw = BlockRaw {
                    indent_str,
                    bullet,
                    marker_str,
                    trailing: Vec::new(),
                };
                let block = Block {
                    id: Some(id),
                    indent,
                    status,
                    priority,
                    content,
                    props: HashMap::new(),
                    urgency: None,
                    importance: None,
                    logbook: Vec::new(),
                    links,
                    children: Vec::new(),
                    parent: None,
                    raw,
                };
                while let Some((lvl, _)) = stack.last() {
                    if *lvl < indent {
                        break;
                    }
                    stack.pop();
                }
                if let Some((_, parent_idx)) = stack.last().copied() {
                    blocks[parent_idx].children.push(id);
                    let parent_id = blocks[parent_idx].id;
                    let mut blk = block;
                    blk.parent = parent_id;
                    blocks.push(blk);
                } else {
                    blocks.push(block);
                }
                stack.push((indent, blocks.len() - 1));
                i += 1;
            }
            Line::Prop {
                indent_str,
                key,
                sep,
                value,
            } => {
                if let Some((_, idx)) = stack.last().copied() {
                    let blk = &mut blocks[idx];
                    // в props-мапу — trim'нутое значение, в trailing — сырое
                    blk.props.insert(key.clone(), value.trim().to_string());
                    blk.raw.trailing.push(Trailing::Prop {
                        indent: indent_str,
                        key,
                        sep,
                        value,
                    });
                    blk.refresh_levels();
                }
                i += 1;
            }
            Line::LogbookOpen(indent_str) => {
                if let Some((_, idx)) = stack.last().copied() {
                    blocks[idx]
                        .raw
                        .trailing
                        .push(Trailing::LogbookStart(indent_str));
                }
                i += 1;
            }
            Line::LogbookClose(indent_str) => {
                if let Some((_, idx)) = stack.last().copied() {
                    blocks[idx]
                        .raw
                        .trailing
                        .push(Trailing::LogbookEnd(indent_str));
                }
                i += 1;
            }
            Line::Clock { indent_str, clock } => {
                if let Some((_, idx)) = stack.last().copied() {
                    let blk = &mut blocks[idx];
                    let ci = blk.logbook.len();
                    blk.logbook.push(clock);
                    blk.raw.trailing.push(Trailing::Clock {
                        indent: indent_str,
                        idx: ci,
                    });
                }
                i += 1;
            }
            Line::Raw { indent_str, text } => {
                // raw до первого блока уходит в преамбулу выше,
                // здесь stack всегда непуст
                if let Some((_, idx)) = stack.last().copied() {
                    blocks[idx].raw.trailing.push(Trailing::Raw {
                        indent: indent_str,
                        text,
                    });
                }
                i += 1;
            }
        }
    }

    ParsedFile {
        preamble,
        blocks,
        trailing_blank,
        ends_with_newline,
    }
}

/// Парсит файл целиком: блоки + заголовок страницы
pub fn parse_file(name: &str, kind: PageKind, text: &str) -> Page {
    let parsed = parse_document(text);
    let mut roots = Vec::new();
    let mut order = Vec::new();
    for b in &parsed.blocks {
        order.push(b.id.expect("свежий uuid всегда есть"));
        if b.parent.is_none() {
            roots.push(b.id.expect("свежий uuid всегда есть"));
        }
    }
    Page {
        name: name.to_string(),
        kind,
        roots,
        order,
        preamble: parsed.preamble,
        trailing_blank: parsed.trailing_blank,
        ends_with_newline: parsed.ends_with_newline,
        mtime: None,
        path: None,
    }
}
