//! Минимальный парсер нужных частей `logseq/config.edn`:
//! `:default-queries :journals` — переводит Datalog-запросы в наши SavedQuery.
//!
//! Логика маппинга:
//! - `:title` → title
//! - набор маркеров в `(contains? #{...} ?marker)` → filter.status
//! - `(= ?name "...")` на странице → filter.page; starts-with? → page_prefix
//! - `:collapsed?` → collapsed

use crate::core::model::Status;
use crate::core::query::{SavedQuery, TaskFilter};

/// Извлекает `:default-queries` из текста config.edn
pub fn parse_default_queries(edn: &str) -> Vec<SavedQuery> {
    let start = match edn.find(":default-queries") {
        Some(i) => i,
        None => return vec![],
    };
    // баланс скобок: находим конец блока :default-queries
    let mut depth = 0i32;
    let mut in_string = false;
    let mut prev = ' ';
    let bytes: Vec<char> = edn[start..].chars().collect();
    let mut end = 0;
    for (i, ch) in bytes.iter().enumerate() {
        match ch {
            '"' if prev != '\\' => in_string = !in_string,
            '{' | '[' | '(' if !in_string => depth += 1,
            '}' | ']' | ')' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    end = i + 1;
                    break;
                }
            }
            _ => {}
        }
        prev = *ch;
    }
    if end == 0 {
        return vec![];
    }
    let block: String = bytes[..end].iter().collect();
    parse_queries_block(&block)
}

fn parse_queries_block(block: &str) -> Vec<SavedQuery> {
    let mut queries = Vec::new();
    // каждый запрос начинается с `{:title`
    let mut pos = 0;
    while let Some(rel) = block[pos..].find("{:title") {
        let abs = pos + rel;
        // найдём конец этого map'а по балансу {}
        let mut depth = 0i32;
        let mut in_string = false;
        let mut prev = ' ';
        let chars: Vec<char> = block[abs..].chars().collect();
        let mut end = 0;
        for (i, ch) in chars.iter().enumerate() {
            match ch {
                '"' if prev != '\\' => in_string = !in_string,
                '{' if !in_string => depth += 1,
                '}' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        end = i + 1;
                        break;
                    }
                }
                _ => {}
            }
            prev = *ch;
        }
        if end == 0 {
            break;
        }
        let one: String = chars[..end].iter().collect();
        if let Some(q) = parse_one_query(&one) {
            queries.push(q);
        }
        pos = abs + end;
    }
    queries
}

fn parse_one_query(text: &str) -> Option<SavedQuery> {
    let title = extract_string(text, ":title")?;
    let collapsed = extract_bool(text, ":collapsed?");
    let mut filter = TaskFilter::default();

    // проходим по всем `(contains? #{...} ?var)` в порядке следования
    for (items, var, negated) in extract_sets(text) {
        match (var.as_str(), negated) {
            // маркеры статусов
            ("?marker", false) => {
                let mut seen = std::collections::HashSet::new();
                for s in items.iter().filter_map(|m| Status::from_marker(m)) {
                    seen.insert(s);
                }
                filter.status = seen.into_iter().collect();
            }
            // точная страница
            ("?name", false) if items.len() == 1 => {
                filter.page = Some(items[0].clone());
            }
            // исключение страницы: (not [(contains? #{"X"} ?name)])
            ("?name", true) if items.len() == 1 => {
                filter.exclude_page = Some(items[0].clone());
            }
            _ => {}
        }
    }

    // альтернативные формы имени страницы
    if filter.page.is_none() && filter.exclude_page.is_none() {
        if let Some(name) = extract_name(text) {
            filter.page = Some(name);
        } else if let Some(prefix) = extract_starts_with(text) {
            filter.page_prefix = Some(prefix);
        }
    }

    Some(SavedQuery {
        title,
        filter,
        sort: vec![],
        collapsed,
    })
}

fn extract_string(text: &str, key: &str) -> Option<String> {
    let pos = text.find(key)?;
    let rest = &text[pos + key.len()..];
    let q = rest.find('"')?;
    let rest = &rest[q + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_bool(text: &str, key: &str) -> bool {
    text.find(key)
        .and_then(|p| text[p + key.len()..].trim_start().find("true"))
        .is_some()
}

/// Все `(contains? #{"A" "B"} ?var)` в тексте запроса.
/// Возвращает (элементы, переменная, отрицание `(not ...)`).
fn extract_sets(text: &str) -> Vec<(Vec<String>, String, bool)> {
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("contains?") {
        let pos = search_from + rel;
        let rest = &text[pos..];
        // negation: ищем "(not" перед этим вхождением в пределах ~40 символов
        let before = &text[pos.saturating_sub(60)..pos];
        let negated = before.rfind("(not").is_some();

        let Some(brace) = rest.find("#{") else {
            search_from = pos + 9;
            continue;
        };
        let set_rest = &rest[brace + 2..];
        let Some(end) = set_rest.find('}') else {
            search_from = pos + 9;
            continue;
        };
        let set_str = &set_rest[..end];
        let items = parse_set_items(set_str);
        // переменная после }
        let after = set_rest[end + 1..].trim_start();
        let var = after
            .chars()
            .take_while(|c| *c == '?' || c.is_alphanumeric())
            .collect::<String>();
        out.push((items, var, negated));
        search_from = pos + brace + 2 + end + 1;
    }
    out
}

/// элементы множества #{...} — с учётом строк в кавычках с пробелами
fn parse_set_items(set: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in set.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' | '\n' if !in_quotes => {
                if !current.is_empty() {
                    items.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        items.push(current);
    }
    items
}

/// точная страница: один из вариантов
///   (= ?name "ИМЯ")          (= "ИМЯ" ?name)
///   [?p :block/original-name "ИМЯ"]
fn extract_name(text: &str) -> Option<String> {
    // (= ?name "ИМЯ")
    if let Some(pos) = text.find("(= ?name \"") {
        let rest = &text[pos + "(= ?name \"".len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    // (= "ИМЯ" ?name)
    if let Some(pos) = text.find("(= \"") {
        let rest = &text[pos + "(= \"".len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    // [?p :block/original-name "ИМЯ"]
    if let Some(pos) = text.find(":block/original-name \"") {
        let rest = &text[pos + ":block/original-name \"".len()..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// (clojure.string/starts-with? ?name "ПРЕФИКС")
fn extract_starts_with(text: &str) -> Option<String> {
    let pos = text.find("starts-with?")?;
    let rest = &text[pos..];
    let q = rest.find('"')?;
    let rest = &rest[q + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
 :default-queries
 {:journals
  [{:title "Сейчас"
    :query [:find (pull ?h [*])
            :where
            [?h :block/marker ?marker]
            [(contains? #{"NOW" "DOING"} ?marker)]]
    :result-transform (fn [result] (sort-by (fn [h] [(get h :block/priority "Z")]) result))
    :collapsed? false}
   {:title "Работа"
    :query [:find (pull ?h [:db/id])
            :where
            [?p :block/original-name ?name]
            [(contains? #{"Пример - TODO"} ?name)]
            [?h :block/marker ?marker]
            [(contains? #{"NOW" "DOING" "TODO"} ?marker)]
            [?p :block/journal? false]]
    :collapsed? true}
   {:title "Gitea"
    :query [:find (pull ?h [*])
            :where
            [?p :block/original-name ?name]
            [(clojure.string/starts-with? ?name "Gitea -")]
            [?h :block/marker ?marker]
            [(contains? #{"NOW" "DOING" "TODO"} ?marker)]]
    :collapsed? true}
   {:title "Остальные дела"
    :query [:find (pull ?h [*])
            :in $ ?start ?today
            :where
            [?p :block/original-name ?name]
            (not [(contains? #{"Пример - TODO"} ?name)])
            [?h :block/marker ?marker]
            [(contains? #{"NOW" "DOING" "TODO"} ?marker)]
            [?p :block/journal-day ?d]
            [(>= ?d ?start)]
            [(<= ?d ?today)]]
    :inputs [:999999d :today]
    :collapsed? true}]
 }
"#;

    #[test]
    fn parses_titles_and_status_sets() {
        let queries = parse_default_queries(SAMPLE);
        assert_eq!(queries.len(), 4, "должно быть 4 запроса");
        assert_eq!(queries[0].title, "Сейчас");
        assert!(queries[0].filter.status.contains(&Status::Doing));
        assert!(!queries[0].collapsed);
        assert_eq!(queries[1].title, "Работа");
        assert_eq!(queries[1].filter.page.as_deref(), Some("Пример - TODO"));
        assert!(queries[1].collapsed);
        assert_eq!(queries[2].title, "Gitea");
        assert_eq!(queries[2].filter.page_prefix.as_deref(), Some("Gitea -"));
        assert_eq!(queries[3].title, "Остальные дела");
        assert_eq!(
            queries[3].filter.exclude_page.as_deref(),
            Some("Пример - TODO")
        );
    }

    #[test]
    fn handles_missing_section() {
        assert!(parse_default_queries("nothing here").is_empty());
    }

    #[test]
    fn handles_real_config_edn() {
        let cfg = include_str!("../tests/fixtures/config.edn");
        let queries = parse_default_queries(cfg);
        assert!(!queries.is_empty(), "должны распарситься запросы");
        assert!(queries.iter().any(|q| q.title == "Сейчас"));
    }
}
