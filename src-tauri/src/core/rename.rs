//! Переименование страниц: точечная замена ссылок в md-тексте.
//!
//! Работает на сыром тексте (после round-trip сериализации байты совпадают
//! с файлом), поэтому заменяются только точные формы ссылок:
//! `[[old]]`, `[[old|псевдоним]]`, `#[[old]]`, `#old` — остальной текст
//! не трогается.

fn code_mask(text: &str) -> Vec<bool> {
    let bytes = text.as_bytes();
    let mut mask = vec![false; bytes.len()];
    let mut line_start = 0;
    let mut fenced = false;
    for line in text.split_inclusive('\n') {
        let line_end = line_start + line.len();
        let is_fence = line.trim_start().starts_with("```");
        if fenced || is_fence {
            mask[line_start..line_end].fill(true);
            if is_fence {
                fenced = !fenced;
            }
            line_start = line_end;
            continue;
        }

        let mut inline_open = None;
        let mut delimiter = 0;
        let mut i = line_start;
        while i < line_end {
            if bytes[i] != b'`' {
                i += 1;
                continue;
            }
            let run_start = i;
            while i < line_end && bytes[i] == b'`' {
                i += 1;
            }
            let run = i - run_start;
            match inline_open {
                Some(open) if run == delimiter => {
                    mask[open..i].fill(true);
                    inline_open = None;
                }
                None => {
                    inline_open = Some(run_start);
                    delimiter = run;
                }
                _ => {}
            }
        }
        if let Some(open) = inline_open {
            mask[open..line_end].fill(true);
        }
        line_start = line_end;
    }
    mask
}

/// Заменяет ссылки на страницу `old` на `new` в md-тексте.
///
/// - `[[old]]` → `[[new]]`;
/// - `[[old|псевдоним]]` → `[[new|псевдоним]]` (псевдоним сохраняется);
/// - `#[[old]]` → `#[[new]]` (форма тега со скобками);
/// - `#old` → `#new` — только когда `old` без пробелов; следующий символ
///   не должен быть буквой/цифрой/`-`/`_`, чтобы `#ALR` не зацепило `#ALR2`.
pub fn replace_refs(text: &str, old: &str, new: &str) -> String {
    let code = code_mask(text);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find(['[', '#']) {
        let absolute = text.len() - rest.len() + pos;
        if code[absolute] {
            out.push_str(&rest[..pos + 1]);
            rest = &rest[pos + 1..];
            continue;
        }
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        if rest.starts_with("[[") {
            if let Some(end) = rest[2..].find("]]") {
                let inner = &rest[2..2 + end];
                let replaced = if inner == old {
                    Some(new.to_string())
                } else if inner.len() > old.len() + 1 && inner.starts_with(old) {
                    // [[old|псевдоним]] — псевдоним сохраняем
                    inner[old.len()..]
                        .strip_prefix('|')
                        .map(|alias| format!("{new}|{alias}"))
                } else {
                    None
                };
                if let Some(r) = replaced {
                    out.push_str("[[");
                    out.push_str(&r);
                    out.push_str("]]");
                    rest = &rest[2 + end + 2..];
                    continue;
                }
            }
            out.push('[');
            rest = &rest[1..];
        } else if rest.starts_with("#[[") {
            let mut consumed = false;
            if let Some(end) = rest[3..].find("]]") {
                let inner = &rest[3..3 + end];
                if inner == old {
                    out.push_str("#[[");
                    out.push_str(new);
                    out.push_str("]]");
                    rest = &rest[3 + end + 2..];
                    consumed = true;
                }
            }
            if !consumed {
                out.push('#');
                rest = &rest[1..];
            }
        } else if rest.starts_with('#') && !old.contains(char::is_whitespace) {
            let after = &rest[1..];
            if let Some(tail) = after.strip_prefix(old) {
                let boundary = tail
                    .chars()
                    .next()
                    .map(|c| !(c.is_alphanumeric() || c == '-' || c == '_'))
                    .unwrap_or(true);
                if boundary {
                    out.push('#');
                    out.push_str(new);
                    rest = tail;
                    continue;
                }
            }
            out.push('#');
            rest = &rest[1..];
        } else {
            // одиночный '[' (не ссылка) или '#' с пробельным old
            out.push_str(&rest[..1]);
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::replace_refs;

    #[test]
    fn replaces_plain_link() {
        assert_eq!(
            replace_refs("см. [[Старое имя]] тут", "Старое имя", "Новое имя"),
            "см. [[Новое имя]] тут"
        );
    }

    #[test]
    fn replaces_link_with_alias() {
        assert_eq!(
            replace_refs("[[Старое|псевдоним]]", "Старое", "Новое"),
            "[[Новое|псевдоним]]"
        );
    }

    #[test]
    fn replaces_hash_link_form() {
        assert_eq!(
            replace_refs("тег #[[Старое имя]] конец", "Старое имя", "Новое имя"),
            "тег #[[Новое имя]] конец"
        );
    }

    #[test]
    fn replaces_plain_tag() {
        assert_eq!(
            replace_refs("сделать #feature и #feature,", "feature", "bugfix"),
            "сделать #bugfix и #bugfix,"
        );
    }

    #[test]
    fn tag_does_not_match_prefix() {
        assert_eq!(replace_refs("#ALR и #ALR2", "ALR", "ALT"), "#ALT и #ALR2");
    }

    #[test]
    fn tag_with_dash_and_underscore_not_matched_partially() {
        assert_eq!(
            replace_refs("#my-tag #my_tag", "my", "your"),
            "#my-tag #my_tag"
        );
    }

    #[test]
    fn spaced_name_skips_plain_tag() {
        // имя с пробелом не может быть #тегом без скобок — не трогаем
        assert_eq!(
            replace_refs("#Старое имя", "Старое имя", "Новое имя"),
            "#Старое имя"
        );
    }

    #[test]
    fn link_does_not_match_prefix() {
        assert_eq!(
            replace_refs("[[Старое2]] и [[Старое]]", "Старое", "Новое"),
            "[[Старое2]] и [[Новое]]"
        );
    }

    #[test]
    fn alias_of_other_page_untouched() {
        assert_eq!(
            replace_refs("[[Старое2|Старое]]", "Старое", "Новое"),
            "[[Старое2|Старое]]"
        );
    }

    #[test]
    fn multiline_and_multiple_occurrences() {
        let text = "- TODO [[A]]\n  заметка про [[A|стр. A]] и #[[A]]\n- другое [[B]]\n";
        // псевдоним ссылки сохраняется дословно, даже если совпадает с именем
        let expected = "- TODO [[C]]\n  заметка про [[C|стр. A]] и #[[C]]\n- другое [[B]]\n";
        assert_eq!(replace_refs(text, "A", "C"), expected);
    }

    #[test]
    fn no_refs_returns_same_text() {
        let text = "- просто текст\n  prop:: value\n";
        assert_eq!(replace_refs(text, "Нет такой", "Другая"), text);
    }

    #[test]
    fn unclosed_brackets_ignored() {
        assert_eq!(
            replace_refs("[[Старое и [[ вложенное", "Старое", "Новое"),
            "[[Старое и [[ вложенное"
        );
    }

    #[test]
    fn refs_in_inline_and_fenced_code_unchanged() {
        let text = "- [[A]] `[[A]] #A` `` [[A]] ``\n  ```md\n  [[A]] #A\n  ```\n- #A\n";
        let expected = "- [[B]] `[[A]] #A` `` [[A]] ``\n  ```md\n  [[A]] #A\n  ```\n- #B\n";
        assert_eq!(replace_refs(text, "A", "B"), expected);
    }
}
