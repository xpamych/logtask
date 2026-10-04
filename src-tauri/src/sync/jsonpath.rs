//! Минимальное подмножество JSONPath для конфигов интеграций:
//! `$.a.b`, `$.arr[0]`, `$.arr[*]`, `$.arr[*].b`. Без фильтров/рекурсии/скриптов.

use serde_json::Value;

/// Возвращает все значения по пути. Пустой вектор — путь ничего не нашёл.
pub fn select<'a>(value: &'a Value, path: &str) -> Vec<&'a Value> {
    let path = path.trim();
    let path = path.strip_prefix('$').unwrap_or(path);
    let mut current: Vec<&Value> = vec![value];
    for seg in path.split('.').filter(|s| !s.is_empty()) {
        // сегмент вида name, name[*] или name[3]
        let (name, idx) = match seg.find('[') {
            Some(i) => (&seg[..i], seg[i..].trim_matches(['[', ']'])),
            None => (seg, ""),
        };
        let mut next = Vec::new();
        for v in current {
            let target = if name.is_empty() {
                Some(v)
            } else {
                v.get(name)
            };
            if let Some(t) = target {
                match idx {
                    "" => next.push(t),
                    "*" => {
                        if let Some(arr) = t.as_array() {
                            next.extend(arr.iter());
                        }
                    }
                    n => {
                        if let Ok(i) = n.parse::<usize>() {
                            if let Some(el) = t.get(i) {
                                next.push(el);
                            }
                        }
                    }
                }
            }
        }
        current = next;
    }
    current
}

/// Первое значение по пути как строка (числа/булевы — в текстовом виде)
pub fn select_string(value: &Value, path: &str) -> Option<String> {
    select(value, path)
        .into_iter()
        .next()
        .and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({
            "tasks": [
                {"id": 1, "title": "Первая", "meta": {"state": "new"}},
                {"id": 2, "title": "Вторая", "meta": {"state": "done"}}
            ],
            "total": 2,
            "ok": true
        })
    }

    #[test]
    fn selects_nested_field() {
        assert_eq!(select_string(&doc(), "$.total").as_deref(), Some("2"));
        assert_eq!(select_string(&doc(), "$.ok").as_deref(), Some("true"));
    }

    #[test]
    fn selects_array_wildcard() {
        let doc = doc();
        let items = select(&doc, "$.tasks[*]");
        assert_eq!(items.len(), 2);
        let titles = select(&doc, "$.tasks[*].title");
        assert_eq!(titles.len(), 2);
    }

    #[test]
    fn field_of_each_item() {
        let doc = doc();
        let first = &select(&doc, "$.tasks[*]")[0];
        assert_eq!(select_string(first, "$.meta.state").as_deref(), Some("new"));
        assert_eq!(select_string(first, "$.id").as_deref(), Some("1"));
    }

    #[test]
    fn selects_array_index() {
        assert_eq!(
            select_string(&doc(), "$.tasks[1].title").as_deref(),
            Some("Вторая")
        );
    }

    #[test]
    fn missing_path_is_empty() {
        assert!(select(&doc(), "$.nope.deeper").is_empty());
        assert_eq!(select_string(&doc(), "$.tasks[9].title"), None);
    }

    #[test]
    fn works_without_dollar() {
        assert_eq!(select_string(&doc(), "total").as_deref(), Some("2"));
    }
}
