//! Настройки приложения: тема, шрифты, набор статусов канбана.
//! Хранятся в <граф>/.logtask/settings.json — travelled together с графом.

use serde::{Deserialize, Serialize};

/// Настройка одного статуса в канбане
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusConfig {
    /// маркер Logseq: LATER/TODO/DOING/REVIEW/DONE/CANCELED
    pub marker: String,
    /// подпись на русском
    pub label: String,
    /// цвет акцента
    pub color: String,
    /// показывать колонку в канбане
    #[serde(default = "default_true")]
    pub visible: bool,
    /// шорткат (позже — переназначение)
    #[serde(default)]
    pub shortcut: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphColorGroup {
    pub id: String,
    pub query: String,
    pub color: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub clustered: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphViewSettings {
    pub search: String,
    pub show_journals: bool,
    pub show_tags: bool,
    pub show_assets: bool,
    pub only_existing: bool,
    pub hide_orphans: bool,
    pub exclusions: Vec<String>,
    pub groups: Vec<GraphColorGroup>,
    pub arrows: bool,
    pub node_scale: f64,
    pub edge_scale: f64,
    pub label_threshold: f64,
    pub center_force: f64,
    pub repel_force: f64,
    pub link_force: f64,
    pub link_distance: f64,
    pub alpha_decay: f64,
    pub local_depth: u8,
    pub journal_aggregation: String,
    pub cluster_threshold: usize,
}

impl Default for GraphViewSettings {
    fn default() -> Self {
        Self {
            search: String::new(),
            show_journals: false,
            show_tags: false,
            show_assets: false,
            only_existing: true,
            hide_orphans: false,
            exclusions: Vec::new(),
            groups: Vec::new(),
            arrows: false,
            node_scale: 1.0,
            edge_scale: 1.0,
            label_threshold: 0.35,
            center_force: 0.12,
            repel_force: 45.0,
            link_force: 0.75,
            link_distance: 35.0,
            alpha_decay: 0.025,
            local_depth: 1,
            journal_aggregation: "month".into(),
            cluster_threshold: 20,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "system" | "dark" | "light"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// масштаб шрифта: 0.85 … 1.4
    #[serde(default = "default_font_scale")]
    pub font_scale: f64,
    /// первый день недели: 0 (воскресенье) | 1 (понедельник)
    #[serde(default = "default_week_start")]
    pub week_start: u8,
    /// сколько задач показывать в колонке канбана
    #[serde(default = "default_kanban_limit")]
    pub kanban_limit: usize,
    /// ширина левой панели (px)
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    /// ширина правой панели задач (px)
    #[serde(default = "default_taskpanel_width")]
    pub taskpanel_width: u32,
    /// избранные страницы (звёздочка), в порядке добавления
    #[serde(default)]
    pub favorites: Vec<String>,
    /// true — системная рамка окна вместо встроенных кнопок управления
    #[serde(default)]
    pub system_titlebar: bool,
    /// домашний вид: "journal" | "tasks" | "pages" | "graph" (кнопка ⌂ и старт приложения)
    #[serde(default = "default_home_view")]
    pub home_view: String,
    /// статусы канбана: набор/цвета/порядок
    #[serde(default = "default_statuses")]
    pub statuses: Vec<StatusConfig>,
    /// источники синхронизации задач (раздел «Интеграции»)
    #[serde(default)]
    pub integrations: crate::sync::config::IntegrationsConfig,
    #[serde(default)]
    pub graph_view: GraphViewSettings,
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_font_scale() -> f64 {
    1.0
}

fn default_week_start() -> u8 {
    1
}

fn default_kanban_limit() -> usize {
    50
}

fn default_sidebar_width() -> u32 {
    240
}

fn default_taskpanel_width() -> u32 {
    320
}

fn default_home_view() -> String {
    "journal".to_string()
}

/// Дефолтный набор статусов (порядок канбана)
pub fn default_statuses() -> Vec<StatusConfig> {
    vec![
        StatusConfig {
            marker: "LATER".into(),
            label: "Бэклог".into(),
            color: "#888888".into(),
            visible: true,
            shortcut: None,
        },
        StatusConfig {
            marker: "TODO".into(),
            label: "К выполнению".into(),
            color: "#09bec8".into(),
            visible: true,
            shortcut: None,
        },
        StatusConfig {
            marker: "DOING".into(),
            label: "В работе".into(),
            // синий, чтобы не пересекаться с оранжевой «средней»
            // срочностью/важностью (уровни: danger/warning/fg-muted)
            color: "#2196f3".into(),
            visible: true,
            shortcut: None,
        },
        StatusConfig {
            marker: "REVIEW".into(),
            label: "На проверке".into(),
            color: "#9b59b6".into(),
            visible: true,
            shortcut: None,
        },
        StatusConfig {
            marker: "DONE".into(),
            label: "Выполнено".into(),
            color: "#4caf50".into(),
            visible: true,
            shortcut: None,
        },
        StatusConfig {
            marker: "CANCELED".into(),
            label: "Отменено".into(),
            color: "#a05252".into(),
            visible: true,
            shortcut: None,
        },
    ]
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: default_theme(),
            font_scale: default_font_scale(),
            week_start: default_week_start(),
            kanban_limit: default_kanban_limit(),
            sidebar_width: default_sidebar_width(),
            taskpanel_width: default_taskpanel_width(),
            favorites: Vec::new(),
            system_titlebar: false,
            home_view: default_home_view(),
            statuses: default_statuses(),
            integrations: Default::default(),
            graph_view: Default::default(),
        }
    }
}

/// Читает настройки графа. Если файла нет — дефолтные.
pub fn load(root: &std::path::Path) -> Settings {
    let path = root.join(".logtask").join("settings.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

/// Сохраняет настройки графа.
pub fn save(root: &std::path::Path, settings: &Settings) -> std::io::Result<()> {
    let dir = root.join(".logtask");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("settings.json");
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| std::io::Error::other(format!("сериализация: {e}")))?;
    crate::core::fswrite::atomic_write(&path, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_six_statuses() {
        let s = Settings::default();
        assert_eq!(s.statuses.len(), 6);
        assert_eq!(s.statuses[0].marker, "LATER");
        assert_eq!(s.statuses[2].label, "В работе");
        assert_eq!(s.theme, "system");
        assert_eq!(s.sidebar_width, 240);
        assert_eq!(s.taskpanel_width, 320);
        assert!(s.favorites.is_empty());
        assert!(!s.system_titlebar);
        assert_eq!(s.home_view, "journal");
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir().join("logtask_settings_test");
        let _ = std::fs::remove_dir_all(&dir);
        let s = Settings {
            theme: "light".into(),
            font_scale: 1.2,
            sidebar_width: 300,
            taskpanel_width: 400,
            favorites: vec!["Пример - TODO".into()],
            system_titlebar: true,
            statuses: {
                let mut st = default_statuses();
                st[0].visible = false;
                st
            },
            ..Default::default()
        };
        save(&dir, &s).unwrap();

        let loaded = load(&dir);
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.font_scale, 1.2);
        assert_eq!(loaded.sidebar_width, 300);
        assert_eq!(loaded.taskpanel_width, 400);
        assert_eq!(loaded.favorites, vec!["Пример - TODO".to_string()]);
        assert!(loaded.system_titlebar);
        assert!(!loaded.statuses[0].visible);
        assert_eq!(loaded.home_view, "journal");
        assert_eq!(loaded.statuses.len(), 6);
    }

    #[test]
    fn graph_view_settings_default_for_old_settings() {
        let dir = std::env::temp_dir().join("logtask_settings_graph_defaults");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".logtask")).unwrap();
        std::fs::write(dir.join(".logtask/settings.json"), "{}").unwrap();
        let loaded = load(&dir);
        assert!(!loaded.graph_view.show_journals);
        assert!(!loaded.graph_view.show_tags);
        assert!(!loaded.graph_view.show_assets);
        assert!(loaded.graph_view.only_existing);
        assert!(!loaded.graph_view.hide_orphans);
        assert!(!loaded.graph_view.arrows);
        assert_eq!(loaded.graph_view.local_depth, 1);
        assert_eq!(loaded.graph_view.journal_aggregation, "month");
        assert_eq!(loaded.graph_view.cluster_threshold, 20);
        assert_eq!(loaded.graph_view.center_force, 0.12);
        assert_eq!(loaded.graph_view.repel_force, 45.0);
        assert_eq!(loaded.graph_view.link_force, 0.75);
        assert_eq!(loaded.graph_view.link_distance, 35.0);
        assert_eq!(loaded.graph_view.alpha_decay, 0.025);
    }

    #[test]
    fn graph_view_settings_roundtrip_preserves_groups_and_physics() {
        let dir = std::env::temp_dir().join("logtask_settings_graph_roundtrip");
        let _ = std::fs::remove_dir_all(&dir);
        let mut settings = Settings::default();
        settings.home_view = "graph".into();
        settings.graph_view.search = "проект".into();
        settings.graph_view.local_depth = 3;
        settings.graph_view.repel_force = 180.0;
        settings.graph_view.groups.push(GraphColorGroup {
            id: "active".into(),
            query: "tag:active".into(),
            color: "#09bec8".into(),
            enabled: true,
            clustered: true,
        });
        save(&dir, &settings).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.home_view, "graph");
        assert_eq!(loaded.graph_view.search, "проект");
        assert_eq!(loaded.graph_view.local_depth, 3);
        assert_eq!(loaded.graph_view.repel_force, 180.0);
        assert_eq!(loaded.graph_view.groups.len(), 1);
        assert_eq!(loaded.graph_view.groups[0].query, "tag:active");
        assert!(loaded.graph_view.groups[0].clustered);
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = std::env::temp_dir().join("logtask_settings_missing");
        let _ = std::fs::remove_dir_all(&dir);
        let s = load(&dir);
        assert_eq!(s.theme, "system");
        assert_eq!(s.sidebar_width, 240);
    }
}
