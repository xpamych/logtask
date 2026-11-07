use super::{BackendStatus, ShortcutAction};
use std::path::Path;
use std::process::Command;

const SHORTCUTS: [(ShortcutAction, &str, &str); 3] = [
    (ShortcutAction::Open, "open", "Ctrl+Alt+space"),
    (ShortcutAction::Today, "today", "Ctrl+Alt+j"),
    (ShortcutAction::NewTask, "new-task", "Ctrl+Shift+t"),
];

#[derive(Debug, PartialEq, Eq)]
struct SwayPlan {
    commands: Vec<String>,
    conflicts: Vec<String>,
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn action_command(path: &Path, id: &str) -> String {
    format!("exec {} --shortcut {id}", shell_quote(path))
}

fn binding_command<'a>(config: &'a str, key: &str) -> Option<&'a str> {
    config.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix("bindsym")?;
        if !rest.starts_with(char::is_whitespace) {
            return None;
        }
        let rest = rest.trim_start();
        let key_end = rest.find(char::is_whitespace)?;
        if &rest[..key_end] == key {
            Some(rest[key_end..].trim())
        } else {
            None
        }
    })
}

fn plan_bindings(config: &str, executable: &Path) -> SwayPlan {
    let mut plan = SwayPlan {
        commands: Vec::new(),
        conflicts: Vec::new(),
    };
    for (_, id, key) in SHORTCUTS {
        let command = action_command(executable, id);
        match binding_command(config, key) {
            Some(existing) if existing == command => {}
            Some(_) => plan.conflicts.push(format!("{id}: {key}")),
            None => plan.commands.push(format!("bindsym {key} {command}")),
        }
    }
    plan
}

fn plan_unbindings(config: &str, executable: &Path) -> Vec<String> {
    SHORTCUTS
        .into_iter()
        .filter(|(_, id, key)| {
            binding_command(config, key) == Some(action_command(executable, id).as_str())
        })
        .map(|(_, _, key)| format!("unbindsym {key}"))
        .collect()
}

fn current_config() -> Result<String, String> {
    let output = Command::new("swaymsg")
        .args(["-t", "get_config"])
        .output()
        .map_err(|error| format!("не удалось запустить swaymsg: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "swaymsg -t get_config завершился с ошибкой: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let reply: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("некорректный ответ swaymsg: {error}"))?;
    reply["config"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "ответ swaymsg не содержит config".to_string())
}

fn run_command(command: &str) -> Result<(), String> {
    let output = Command::new("swaymsg")
        .arg(command)
        .output()
        .map_err(|error| format!("не удалось запустить swaymsg: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "swaymsg отклонил {command:?}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub fn start_sway() -> BackendStatus {
    let result = std::env::current_exe()
        .map_err(|error| format!("не удалось определить путь Logtask: {error}"))
        .and_then(|executable| {
            let config = current_config()?;
            let plan = plan_bindings(&config, &executable);
            for command in &plan.commands {
                run_command(command)?;
            }
            Ok(plan.conflicts)
        });
    match result {
        Ok(conflicts) => BackendStatus {
            active: true,
            conflicts,
            error: None,
        },
        Err(error) => {
            log::warn!("глобальные сочетания Sway недоступны: {error}");
            BackendStatus {
                active: false,
                conflicts: Vec::new(),
                error: Some(error),
            }
        }
    }
}

pub fn stop_sway() {
    let result = std::env::current_exe()
        .map_err(|error| format!("не удалось определить путь Logtask: {error}"))
        .and_then(|executable| {
            let config = current_config()?;
            for command in plan_unbindings(&config, &executable) {
                run_command(&command)?;
            }
            Ok(())
        });
    if let Err(error) = result {
        log::warn!("не удалось удалить глобальные сочетания Sway: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{plan_bindings, plan_unbindings, shell_quote, SwayPlan};
    use std::path::Path;

    #[test]
    fn executable_path_is_shell_quoted() {
        assert_eq!(
            shell_quote(Path::new("/opt/Log task/it's/logtask")),
            "'/opt/Log task/it'\\''s/logtask'"
        );
    }

    #[test]
    fn free_keys_are_bound_and_existing_own_binding_is_reused() {
        let config = "bindsym Ctrl+Alt+space exec '/opt/logtask' --shortcut open\n";
        let plan = plan_bindings(config, Path::new("/opt/logtask"));

        assert_eq!(plan.conflicts, Vec::<String>::new());
        assert_eq!(
            plan.commands,
            vec![
                "bindsym Ctrl+Alt+j exec '/opt/logtask' --shortcut today",
                "bindsym Ctrl+Shift+t exec '/opt/logtask' --shortcut new-task",
            ]
        );
    }

    #[test]
    fn foreign_binding_conflicts_without_being_overwritten() {
        let config = "bindsym Ctrl+Alt+space exec /usr/bin/other --open\n";
        let plan = plan_bindings(config, Path::new("/opt/logtask"));

        assert_eq!(plan.conflicts, vec!["open: Ctrl+Alt+space"]);
        assert_eq!(
            plan.commands,
            vec![
                "bindsym Ctrl+Alt+j exec '/opt/logtask' --shortcut today",
                "bindsym Ctrl+Shift+t exec '/opt/logtask' --shortcut new-task",
            ]
        );
        assert!(!plan
            .commands
            .iter()
            .any(|command| command.contains("space")));
    }

    #[test]
    fn shutdown_unbinds_only_unchanged_own_bindings() {
        let config = concat!(
            "bindsym Ctrl+Alt+space exec '/opt/logtask' --shortcut open\n",
            "bindsym Ctrl+Alt+j exec /usr/bin/other --shortcut today\n",
            "bindsym Ctrl+Shift+t exec '/opt/new-logtask' --shortcut new-task\n",
        );

        assert_eq!(
            plan_unbindings(config, Path::new("/opt/logtask")),
            vec!["unbindsym Ctrl+Alt+space"]
        );
    }

    #[test]
    fn binding_comments_do_not_hide_free_keys() {
        let plan = plan_bindings(
            "# bindsym Ctrl+Alt+space exec /usr/bin/other\n",
            Path::new("/opt/logtask"),
        );

        assert_eq!(
            plan,
            SwayPlan {
                conflicts: vec![],
                commands: vec![
                    "bindsym Ctrl+Alt+space exec '/opt/logtask' --shortcut open".to_string(),
                    "bindsym Ctrl+Alt+j exec '/opt/logtask' --shortcut today".to_string(),
                    "bindsym Ctrl+Shift+t exec '/opt/logtask' --shortcut new-task".to_string(),
                ],
            }
        );
    }
}
