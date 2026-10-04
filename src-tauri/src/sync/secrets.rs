//! Секреты интеграций: системное хранилище ключей (keyring).
//! В конфиге лежат только имена: ${secret:имя}.
//! Для тестов и CI: переменная окружения LOGTASK_SECRET_<ИМЯ> имеет приоритет.

const SERVICE: &str = "logtask";

/// Стабильный ключ графа для пространства имён секретов
pub fn graph_key(root: &std::path::Path) -> String {
    super::fnv1a_hex(root.to_string_lossy().as_bytes())
}

fn account(graph_key: &str, name: &str) -> String {
    format!("{graph_key}/{name}")
}

fn env_name(name: &str) -> String {
    let upper: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("LOGTASK_SECRET_{upper}")
}

pub fn set(graph_key: &str, name: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .set_password(value)
        .map_err(|e| format!("keyring set {name:?}: {e}"))
}

pub fn get(graph_key: &str, name: &str) -> Result<String, String> {
    // env-override: для тестов (без системного keyring) и CI
    if let Ok(v) = std::env::var(env_name(name)) {
        return Ok(v);
    }
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .get_password()
        .map_err(|e| format!("секрет {name:?} не найден в хранилище: {e}"))
}

pub fn delete(graph_key: &str, name: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &account(graph_key, name))
        .map_err(|e| format!("keyring: {e}"))?;
    entry
        .delete_credential()
        .map_err(|e| format!("keyring delete {name:?}: {e}"))
}

pub fn is_set(graph_key: &str, name: &str) -> bool {
    get(graph_key, name).is_ok()
}

/// Подставляет ${secret:имя} в строку конфига
pub fn resolve(text: &str, graph_key: &str) -> Result<String, String> {
    const MARK: &str = "${secret:";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(MARK) {
        out.push_str(&rest[..start]);
        let after = &rest[start + MARK.len()..];
        let end = after
            .find('}')
            .ok_or("незакрытый плейсхолдер ${secret:…}")?;
        let name = &after[..end];
        out.push_str(&get(graph_key, name)?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_key_stable_and_distinct() {
        let a = graph_key(std::path::Path::new("/tmp/graph-a"));
        assert_eq!(a, graph_key(std::path::Path::new("/tmp/graph-a")));
        assert_ne!(a, graph_key(std::path::Path::new("/tmp/graph-b")));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn env_override_wins() {
        std::env::set_var("LOGTASK_SECRET_TEST_OVERRIDE", "from-env");
        assert_eq!(get("any-graph", "test-override").unwrap(), "from-env");
        std::env::remove_var("LOGTASK_SECRET_TEST_OVERRIDE");
    }

    #[test]
    fn resolve_substitutes_placeholders() {
        std::env::set_var("LOGTASK_SECRET_TOK", "abc123");
        let got = resolve("Bearer ${secret:tok}", "g").unwrap();
        assert_eq!(got, "Bearer abc123");
        let got = resolve("${secret:tok}/x/${secret:tok}", "g").unwrap();
        assert_eq!(got, "abc123/x/abc123");
        std::env::remove_var("LOGTASK_SECRET_TOK");
    }

    #[test]
    fn resolve_passes_plain_text() {
        assert_eq!(resolve("no secrets here", "g").unwrap(), "no secrets here");
    }

    #[test]
    fn resolve_errors_on_unclosed() {
        assert!(resolve("bad ${secret:tok", "g").is_err());
    }

    #[test]
    fn resolve_errors_on_missing_secret() {
        assert!(resolve("${secret:definitely-missing-42}", "g").is_err());
    }
}
