//! Query-движок: фильтры и сортировки для канбана, матрицы и saved-запросов.
//! Заменяет Datalog-запросы из config.edn (см. docs/03-ui.md «Мои запросы»).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::{Block, Graph, Level, Quadrant, Status};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    /// только открытые (не Done/Canceled)
    #[serde(default)]
    pub open: bool,
    /// статусы (пусто — все)
    #[serde(default)]
    pub status: Vec<Status>,
    /// точная страница-источник
    #[serde(default)]
    pub page: Option<String>,
    /// страницы с этим префиксом (как "Gitea -" в config.edn)
    #[serde(default)]
    pub page_prefix: Option<String>,
    /// исключить задачи этой страницы
    #[serde(default)]
    pub exclude_page: Option<String>,
    /// теги
    #[serde(default)]
    pub tags: Vec<String>,
    /// квадрант матрицы
    #[serde(default)]
    pub quadrant: Option<Quadrant>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Status,
    Priority,
    Urgency,
    Importance,
    CreatedAt,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub title: String,
    #[serde(default)]
    pub filter: TaskFilter,
    #[serde(default)]
    pub sort: Vec<SortField>,
    #[serde(default)]
    pub collapsed: bool,
}

/// Сортировка по priority→Z как в config.edn `sort-by-priority`
fn priority_key(block: &Block) -> u8 {
    match block.priority {
        Some(super::model::Priority::A) => 0,
        Some(super::model::Priority::B) => 1,
        Some(super::model::Priority::C) => 2,
        None => 3,
    }
}

fn level_key(l: Level) -> u8 {
    match l {
        Level::High => 0,
        Level::Medium => 1,
        Level::Low => 2,
    }
}

impl Graph {
    /// Применяет saved-запрос (фильтр + сортировка)
    pub fn query(&self, q: &SavedQuery) -> Vec<(Uuid, &Block)> {
        let mut out = self.filter_tasks(&q.filter);
        if q.sort.is_empty() {
            return out;
        }
        out.sort_by(|(_, a), (_, b)| {
            for field in &q.sort {
                let cmp = match field {
                    SortField::Status => a
                        .status
                        .map(|s| s.order())
                        .unwrap_or(99)
                        .cmp(&b.status.map(|s| s.order()).unwrap_or(99)),
                    SortField::Priority => priority_key(a).cmp(&priority_key(b)),
                    SortField::Urgency => {
                        level_key(a.effective_urgency()).cmp(&level_key(b.effective_urgency()))
                    }
                    SortField::Importance => level_key(a.effective_importance())
                        .cmp(&level_key(b.effective_importance())),
                    SortField::CreatedAt => std::cmp::Ordering::Equal, // пока no-op: created_at у блоков нет
                };
                if cmp != std::cmp::Ordering::Equal {
                    return cmp;
                }
            }
            std::cmp::Ordering::Equal
        });
        out
    }

    /// Применяет фильтр к задачам графа
    pub fn filter_tasks(&self, filter: &TaskFilter) -> Vec<(Uuid, &Block)> {
        self.all_tasks()
            .into_iter()
            .filter(|(_, b)| !filter.open || !b.status.map(|s| s.is_done()).unwrap_or(false))
            .filter(|(_, b)| {
                filter.status.is_empty()
                    || b.status
                        .map(|s| filter.status.contains(&s))
                        .unwrap_or(false)
            })
            .filter(|(id, _)| {
                let page = self.page_of_block(id);
                match &filter.exclude_page {
                    Some(p) if page == *p => return false,
                    _ => {}
                }
                match &filter.page {
                    Some(p) => page == *p,
                    None => true,
                }
            })
            .filter(|(id, _)| {
                let page = self.page_of_block(id);
                match &filter.page_prefix {
                    Some(p) => page.starts_with(p),
                    None => true,
                }
            })
            .filter(|(_, b)| {
                filter.tags.is_empty()
                    || filter.tags.iter().all(|t| {
                        b.links.iter().any(|l| match l {
                            super::model::LinkTarget::Tag(name) => name.eq_ignore_ascii_case(t),
                            _ => false,
                        })
                    })
            })
            .filter(|(_, b)| match filter.quadrant {
                Some(q) => b.quadrant() == q,
                None => true,
            })
            .collect()
    }

    /// Задачи по квадрантам матрицы Эйзенхауэра
    pub fn matrix(&self) -> [Vec<(Uuid, &Block)>; 4] {
        let mut quadrants: [Vec<(Uuid, &Block)>; 4] = Default::default();
        for entry in self.all_tasks() {
            let q = entry.1.quadrant();
            let idx = match q {
                Quadrant::Do => 0,
                Quadrant::Schedule => 1,
                Quadrant::Delegate => 2,
                Quadrant::Drop => 3,
            };
            quadrants[idx].push(entry);
        }
        quadrants
    }
}
