use super::ShortcutAction;
use std::path::{Path, PathBuf};

const SHORTCUTS: [(ShortcutAction, &str, &str); 3] = [
    (ShortcutAction::Open, "open", "Ctrl+Alt+Space"),
    (ShortcutAction::Today, "today", "Ctrl+Alt+J"),
    (ShortcutAction::NewTask, "new-task", "Ctrl+Alt+N"),
];

fn kdl_string(value: &str) -> String {
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character => escaped.push(character),
        }
    }
    escaped
}

fn render_config(executable: &Path) -> String {
    let executable = kdl_string(&executable.to_string_lossy());
    let mut config = String::from("binds {\n");
    for (_, id, key) in SHORTCUTS {
        config.push_str(&format!(
            "    {key} {{\n        spawn \"{executable}\" \"--shortcut\" \"{id}\";\n    }}\n"
        ));
    }
    config.push_str("}\n");
    config
}

fn write_config_to(executable: &Path, path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "некорректный путь конфига Niri".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("не удалось создать каталог {}: {error}", parent.display()))?;
    crate::core::fswrite::atomic_write_bytes(path, render_config(executable).as_bytes())
        .map_err(|error| format!("не удалось записать {}: {error}", path.display()))?;
    Ok(path.to_path_buf())
}

pub fn write_niri_config() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("не удалось определить путь Logtask: {error}"))?;
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME не задан".to_string())?;
    let path = PathBuf::from(home).join(".config/niri").join("logtask.kdl");
    write_config_to(&executable, &path)
}

pub fn niri_include() -> &'static str {
    "include \"logtask.kdl\""
}

#[cfg(test)]
mod tests {
    use super::{niri_include, render_config, write_config_to};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "logtask-niri-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn kdl_contains_real_escaped_executable_and_all_actions() {
        let config = render_config(Path::new("/opt/Log task/logtask\"debug"));

        assert!(
            config.contains("spawn \"/opt/Log task/logtask\\\"debug\" \"--shortcut\" \"open\";")
        );
        assert!(
            config.contains("spawn \"/opt/Log task/logtask\\\"debug\" \"--shortcut\" \"today\";")
        );
        assert!(config
            .contains("spawn \"/opt/Log task/logtask\\\"debug\" \"--shortcut\" \"new-task\";"));
        assert!(config.contains("Ctrl+Alt+Space {"));
        assert!(config.contains("Ctrl+Alt+J {"));
        assert!(config.contains("Ctrl+Alt+N {"));
    }

    #[test]
    fn explicit_write_creates_separate_niri_config() {
        let dir = temporary_dir("write");
        let path = dir.join("niri/logtask.kdl");
        let main_config = dir.join("niri/config.kdl");

        let returned = write_config_to(Path::new("/opt/Log task/logtask"), &path).unwrap();
        let config = std::fs::read_to_string(&path).unwrap();

        assert_eq!(returned, path);
        assert!(config.contains("spawn \"/opt/Log task/logtask\" \"--shortcut\" \"new-task\";"));
        assert!(!main_config.exists());

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn include_instruction_targets_generated_file() {
        assert_eq!(niri_include(), "include \"logtask.kdl\"");
    }
}
