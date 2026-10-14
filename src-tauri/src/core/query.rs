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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortField {
    Status,
    Priority,
    Urgency,
    Importance,
    CreatedAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}

/// Правило сортировки подборки: поле + направление.
/// Принимает и старый формат (`"priority"` = Asc) для совместимости
/// со старыми `.logtask/queries.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SortRule {
    pub field: SortField,
    pub direction: SortDirection,
}

impl<'de> Deserialize<'de> for SortRule {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Legacy(SortField),
            Full {
                field: SortField,
                #[serde(default)]
                direction: SortDirection,
            },
        }
        Ok(match Repr::deserialize(deserializer)? {
            Repr::Legacy(field) => SortRule {
                field,
                direction: SortDirection::Asc,
            },
            Repr::Full { field, direction } => SortRule { field, direction },
        })
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub title: String,
    #[serde(default)]
    pub filter: TaskFilter,
    #[serde(default)]
    pub sort: Vec<SortRule>,
    #[serde(default)]
    pub collapsed: bool,
}

/// Ключ сортировки по маркеру приоритета; None — у блоков без приоритета
fn priority_key(block: &Block) -> Option<u8> {
    block.priority.map(|p| match p {
        super::model::Priority::A => 0,
        super::model::Priority::B => 1,
        super::model::Priority::C => 2,
    })
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
            for rule in &q.sort {
                let key = |blk: &Block| -> Option<u8> {
                    match rule.field {
                        SortField::Status => blk.status.map(|s| s.order()),
                        SortField::Priority => priority_key(blk),
                        SortField::Urgency => Some(level_key(blk.effective_urgency())),
                        SortField::Importance => Some(level_key(blk.effective_importance())),
                        SortField::CreatedAt => None, // no-op: created_at у блоков нет
                    }
                };
                // None (нет значения) — всегда в конце, при любом направлении
                let cmp = match (key(a), key(b)) {
                    (None, None) => std::cmp::Ordering::Equal,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (Some(x), Some(y)) => match rule.direction {
                        SortDirection::Asc => x.cmp(&y),
                        SortDirection::Desc => y.cmp(&x),
                    },
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(field: SortField, direction: SortDirection) -> SortRule {
        SortRule { field, direction }
    }

    #[test]
    fn sort_rule_legacy_format_deserializes_as_asc() {
        let q: SavedQuery = serde_json::from_str(
            r#"{"title":"t","sort":["priority","status"]}"#,
        )
        .unwrap();
        assert_eq!(
            q.sort,
            vec![
                rule(SortField::Priority, SortDirection::Asc),
                rule(SortField::Status, SortDirection::Asc),
            ]
        );
    }

    #[test]
    fn sort_rule_new_format_roundtrip() {
        let q = SavedQuery {
            title: "t".into(),
            filter: TaskFilter::default(),
            sort: vec![rule(SortField::Importance, SortDirection::Desc)],
            collapsed: false,
        };
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains(r#""sort":[{"field":"importance","direction":"desc"}]"#));
        let back: SavedQuery = serde_json::from_str(&json).unwrap();
        assert_eq!(back.sort, q.sort);
    }

    #[test]
    fn sort_rule_default_direction_is_asc() {
        let r: SortRule = serde_json::from_str(r#"{"field":"urgency"}"#).unwrap();
        assert_eq!(r, rule(SortField::Urgency, SortDirection::Asc));
    }

    use crate::core::index::IndexStats;
    use crate::core::model::PageKind;

    fn graph_from(content: &str) -> Graph {
        let mut g = Graph::default();
        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        g.index_file_content("тест", PageKind::Page, content, None, &mut stats, None);
        g
    }

    fn query_with(sort: Vec<SortRule>) -> SavedQuery {
        SavedQuery {
            title: "t".into(),
            filter: TaskFilter::default(),
            sort,
            collapsed: false,
        }
    }

    fn contents(g: &Graph, q: &SavedQuery) -> Vec<String> {
        g.query(q)
            .into_iter()
            .map(|(_, b)| b.content.clone())
            .collect()
    }

    #[test]
    fn query_sorts_by_priority_desc_with_none_last() {
        // каноническая позиция [#X] — сразу после маркера статуса (как в Logseq);
        // тогда парсер вырезает его из content и кладёт в block.priority
        let g = graph_from("- TODO [#A] А\n- DOING [#C] Б\n- LATER В\n");
        let q = query_with(vec![rule(SortField::Priority, SortDirection::Desc)]);
        assert_eq!(contents(&g, &q), vec!["Б", "А", "В"]);
    }

    #[test]
    fn query_sort_none_last_also_when_asc() {
        let g = graph_from("- TODO [#A] А\n- LATER В\n");
        let q = query_with(vec![rule(SortField::Priority, SortDirection::Asc)]);
        assert_eq!(contents(&g, &q), vec!["А", "В"]);
    }

    #[test]
    fn query_sort_chain_uses_second_field_as_tiebreak() {
        // одинаковая важность (medium из [#B]) → решает статус asc: LATER раньше DOING
        let g = graph_from("- DOING [#B] Б\n- LATER [#B] В\n");
        let q = query_with(vec![
            rule(SortField::Importance, SortDirection::Desc),
            rule(SortField::Status, SortDirection::Asc),
        ]);
        assert_eq!(contents(&g, &q), vec!["В", "Б"]);
    }
}
