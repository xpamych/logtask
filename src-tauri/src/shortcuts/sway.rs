use super::ShortcutAction;
use std::path::Path;
use std::process::Command;

pub struct SwayResult {
    pub active: bool,
    pub conflicts: Vec<String>,
    pub error: Option<String>,
}

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

#[derive(Debug, PartialEq, Eq)]
struct Binding<'a> {
    key: &'a str,
    command: &'a str,
    plain: bool,
}

fn parse_bindings(config: &str) -> (Vec<Binding<'_>>, bool) {
    let mut bindings = Vec::new();
    let mut unrecognized = false;
    for line in config.lines() {
        let line = line.trim();
        if line == "bindsym" {
            unrecognized = true;
            continue;
        }
        let Some(rest) = line.strip_prefix("bindsym") else {
            continue;
        };
        if !rest.starts_with(char::is_whitespace) {
            continue;
        }
        let mut rest = rest.trim_start();
        let mut plain = true;
        let mut valid = true;
        while rest.starts_with("--") {
            let Some(option_end) = rest.find(char::is_whitespace) else {
                unrecognized = true;
                valid = false;
                break;
            };
            let option = &rest[..option_end];
            if !matches!(
                option,
                "--locked"
                    | "--no-warn"
                    | "--release"
                    | "--to-code"
                    | "--no-repeat"
                    | "--inhibited"
                    | "--whole-window"
                    | "--border"
                    | "--exclude-titlebar"
                    | "--contents"
            ) && !option.starts_with("--input-device=")
            {
                unrecognized = true;
                valid = false;
                break;
            }
            plain = false;
            rest = rest[option_end..].trim_start();
        }
        if !valid {
            continue;
        }
        let Some(key_end) = rest.find(char::is_whitespace) else {
            unrecognized = true;
            continue;
        };
        let command = rest[key_end..].trim();
        if command.is_empty() {
            unrecognized = true;
            continue;
        }
        bindings.push(Binding {
            key: &rest[..key_end],
            command,
            plain,
        });
    }
    (bindings, unrecognized)
}

fn plan_bindings(config: &str, executable: &Path) -> SwayPlan {
    let mut plan = SwayPlan {
        commands: Vec::new(),
        conflicts: Vec::new(),
    };
    let (bindings, unrecognized) = parse_bindings(config);
    for (_, id, key) in SHORTCUTS {
        let command = action_command(executable, id);
        let existing: Vec<_> = bindings
            .iter()
            .filter(|binding| binding.key == key)
            .collect();
        if unrecognized || existing.iter().any(|binding| binding.command != command) {
            plan.conflicts.push(format!("{id}: {key}"));
        } else if existing.is_empty() {
            plan.commands.push(format!("bindsym {key} {command}"));
        }
    }
    plan
}

fn plan_unbindings(config: &str, executable: &Path) -> Vec<String> {
    let (bindings, unrecognized) = parse_bindings(config);
    if unrecognized {
        return Vec::new();
    }
    SHORTCUTS
        .into_iter()
        .filter(|(_, id, key)| {
            let command = action_command(executable, id);
            let existing: Vec<_> = bindings
                .iter()
                .filter(|binding| binding.key == *key)
                .collect();
            existing.len() == 1 && existing[0].plain && existing[0].command == command
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

fn apply_plan(plan: SwayPlan, mut run: impl FnMut(&str) -> Result<(), String>) -> SwayResult {
    let SwayPlan {
        commands,
        conflicts,
    } = plan;
    let mut applied: Vec<String> = Vec::new();
    for command in commands {
        if let Err(error) = run(&command) {
            let mut errors = vec![error];
            let mut rollback_failed = false;
            for added in applied.iter().rev() {
                let key = added
                    .split_whitespace()
                    .nth(1)
                    .expect("сгенерированная команда bindsym содержит клавишу");
                let rollback = format!("unbindsym {key}");
                if let Err(error) = run(&rollback) {
                    rollback_failed = true;
                    errors.push(format!("не удалось откатить {rollback:?}: {error}"));
                }
            }
            return SwayResult {
                active: rollback_failed,
                conflicts,
                error: Some(errors.join("; ")),
            };
        }
        applied.push(command);
    }
    SwayResult {
        active: true,
        conflicts,
        error: None,
    }
}

pub fn start_sway() -> SwayResult {
    let result = std::env::current_exe()
        .map_err(|error| format!("не удалось определить путь Logtask: {error}"))
        .and_then(|executable| {
            let config = current_config()?;
            Ok(plan_bindings(&config, &executable))
        });
    let status = match result {
        Ok(plan) => apply_plan(plan, run_command),
        Err(error) => SwayResult {
            active: false,
            conflicts: Vec::new(),
            error: Some(error),
        },
    };
    if let Some(error) = &status.error {
        log::warn!("глобальные сочетания Sway недоступны полностью: {error}");
    }
    status
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
    use super::{apply_plan, plan_bindings, plan_unbindings, shell_quote, SwayPlan};
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
    fn locked_and_release_foreign_bindings_conflict() {
        let config = concat!(
            "bindsym --locked Ctrl+Alt+space exec /usr/bin/other --open\n",
            "bindsym --release Ctrl+Alt+j exec /usr/bin/other --today\n",
        );
        let plan = plan_bindings(config, Path::new("/opt/logtask"));

        assert_eq!(
            plan.conflicts,
            vec!["open: Ctrl+Alt+space", "today: Ctrl+Alt+j"]
        );
        assert_eq!(
            plan.commands,
            vec!["bindsym Ctrl+Shift+t exec '/opt/logtask' --shortcut new-task"]
        );
    }

    #[test]
    fn all_duplicate_binding_variants_are_checked() {
        let config = concat!(
            "bindsym Ctrl+Alt+space exec '/opt/logtask' --shortcut open\n",
            "bindsym --locked Ctrl+Alt+space exec /usr/bin/other --open\n",
            "bindsym Ctrl+Alt+j exec '/opt/logtask' --shortcut today\n",
            "bindsym --release Ctrl+Alt+j exec '/opt/logtask' --shortcut today\n",
        );
        let plan = plan_bindings(config, Path::new("/opt/logtask"));

        assert_eq!(plan.conflicts, vec!["open: Ctrl+Alt+space"]);
        assert_eq!(
            plan.commands,
            vec!["bindsym Ctrl+Shift+t exec '/opt/logtask' --shortcut new-task"]
        );
    }

    #[test]
    fn unrecognized_bindsym_options_conservatively_conflict() {
        let config = "bindsym --future-option Ctrl+Alt+space exec /usr/bin/other\n";
        let plan = plan_bindings(config, Path::new("/opt/logtask"));

        assert_eq!(plan.commands, Vec::<String>::new());
        assert_eq!(
            plan.conflicts,
            vec![
                "open: Ctrl+Alt+space",
                "today: Ctrl+Alt+j",
                "new-task: Ctrl+Shift+t",
            ]
        );
    }

    #[test]
    fn failed_bind_rolls_back_only_commands_added_by_this_invocation() {
        let plan = plan_bindings(
            "bindsym Ctrl+Shift+t exec /usr/bin/other\n",
            Path::new("/opt/logtask"),
        );
        let mut installed = Vec::new();
        let mut calls = Vec::new();

        let status = apply_plan(plan, |command| {
            calls.push(command.to_string());
            if command.contains("Ctrl+Alt+j") {
                return Err("отказ swaymsg".to_string());
            }
            if let Some(key) = command.strip_prefix("unbindsym ") {
                installed.retain(|binding: &String| !binding.contains(key));
            } else {
                installed.push(command.to_string());
            }
            Ok(())
        });

        assert!(installed.is_empty());
        assert_eq!(
            calls,
            vec![
                "bindsym Ctrl+Alt+space exec '/opt/logtask' --shortcut open",
                "bindsym Ctrl+Alt+j exec '/opt/logtask' --shortcut today",
                "unbindsym Ctrl+Alt+space",
            ]
        );
        assert!(!status.active);
        assert_eq!(status.conflicts, vec!["new-task: Ctrl+Shift+t"]);
        assert!(status.error.unwrap().contains("отказ swaymsg"));
    }

    #[test]
    fn failed_rollback_is_reported_as_partial_activity() {
        let plan = plan_bindings("", Path::new("/opt/logtask"));
        let mut installed = Vec::new();

        let status = apply_plan(plan, |command| {
            if command.contains("Ctrl+Alt+j") || command.starts_with("unbindsym ") {
                return Err(format!("отказ: {command}"));
            }
            installed.push(command.to_string());
            Ok(())
        });

        assert_eq!(installed.len(), 1);
        assert!(status.active);
        let error = status.error.unwrap();
        assert!(error.contains("Ctrl+Alt+j"));
        assert!(error.contains("unbindsym Ctrl+Alt+space"));
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
