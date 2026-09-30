//! Модель данных Logtask (см. docs/01-architecture.md).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Уровень срочности/важности задачи
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum Level {
    #[default]
    Low,
    Medium,
    High,
}

/// Сколько дней до дедлайна считается "скоро" для автосрочности
pub const URGENT_DAYS: i64 = 3;

/// Строковое представление уровня для записи в .md
pub fn level_str(l: Level) -> String {
    match l {
        Level::Low => "low",
        Level::Medium => "medium",
        Level::High => "high",
    }
    .to_string()
}

/// Парсит уровень из строки ("high"/"3"/"medium"…)
pub fn parse_level(v: &str) -> Option<Level> {
    match v.trim().to_ascii_lowercase().as_str() {
        "low" | "1" => Some(Level::Low),
        "medium" | "med" | "2" => Some(Level::Medium),
        "high" | "3" => Some(Level::High),
        _ => None,
    }
}

/// deadline:: в формате YYYY-MM-DD — скоро ли (в пределах days дней)?
pub fn deadline_is_soon(deadline: &str, days: i64) -> bool {
    let Some(d) = parse_date(deadline) else {
        return false;
    };
    let now = now_days();
    d >= now && d <= now + days
}

/// День в "днях от эпохи" из строки YYYY-MM-DD
fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let mut parts = s.split('-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // дни от 1970-01-01 без високосных уточнений — достаточно для сравнения
    Some((y - 1970) * 365 + (m as i64 - 1) * 30 + d as i64 - 1)
}

fn now_days() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86400)
        .unwrap_or(0)
}

/// Приоритет Logseq: [#A] > [#B] > [#C]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Priority {
    A,
    B,
    C,
}

impl Priority {
    /// [#A] → high, [#B] → medium, [#C] → low
    pub fn importance(self) -> Level {
        match self {
            Priority::A => Level::High,
            Priority::B => Level::Medium,
            Priority::C => Level::Low,
        }
    }
}

/// Маркеры статусов задач (см. docs/02-format.md)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    /// Бэклог
    Later,
    /// К выполнению
    Todo,
    /// В работе
    Doing,
    /// На проверке
    Review,
    /// Выполнено
    Done,
    /// Отменено
    Canceled,
}

impl Status {
    /// Порядок в канбане
    pub fn order(self) -> u8 {
        match self {
            Status::Later => 0,
            Status::Todo => 1,
            Status::Doing => 2,
            Status::Review => 3,
            Status::Done => 4,
            Status::Canceled => 5,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Status::Later => "Бэклог",
            Status::Todo => "К выполнению",
            Status::Doing => "В работе",
            Status::Review => "На проверке",
            Status::Done => "Выполнено",
            Status::Canceled => "Отменено",
        }
    }

    pub fn is_done(self) -> bool {
        matches!(self, Status::Done | Status::Canceled)
    }

    /// Все валидные маркеры Logseq, которые понимаем
    pub fn from_marker(s: &str) -> Option<Self> {
        match s.trim() {
            "LATER" | "BACKLOG" => Some(Status::Later),
            "TODO" => Some(Status::Todo),
            "DOING" | "IN-PROGRESS" | "STARTED" | "NOW" => Some(Status::Doing),
            "REVIEW" | "WAITING" | "WAIT" => Some(Status::Review),
            "DONE" | "COMPLETED" => Some(Status::Done),
            "CANCELED" | "CANCELLED" => Some(Status::Canceled),
            _ => None,
        }
    }

    /// Каноничный маркер для записи в .md
    pub fn to_marker(self) -> &'static str {
        match self {
            Status::Later => "LATER",
            Status::Todo => "TODO",
            Status::Doing => "DOING",
            Status::Review => "REVIEW",
            Status::Done => "DONE",
            Status::Canceled => "CANCELED",
        }
    }
}

/// Квадрант матрицы Эйзенхауэра
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Quadrant {
    /// I — сделать: срочно + важно
    Do,
    /// II — запланировать: несрочно + важно
    Schedule,
    /// III — делегировать/быстро: срочно + неважно
    Delegate,
    /// IV — выкинуть: несрочно + неважно
    Drop,
}

/// Запись учёта времени в :LOGBOOK:
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clock {
    pub start: String,
    pub end: Option<String>,
    /// "H:MM:SS", считывается из "=>  H:MM:SS" если есть
    pub duration: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LinkTarget {
    /// [[Имя страницы]] — вики-ссылка
    Page(String),
    /// #тег
    Tag(String),
    /// ((uuid)) — block reference (только чтение)
    Block(String),
}

/// Запись в блоке после его основной строки: свойство, логбук или сырая строка.
/// Порядок важен для round-trip сериализации. Каждый вариант хранит свой
/// точный отступ, чтобы сериализация давала байт-в-байт исходный текст.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trailing {
    Prop {
        indent: String,
        key: String,
        value: String,
    },
    /// `:LOGBOOK:`
    LogbookStart(String),
    /// `:END:`
    LogbookEnd(String),
    Raw {
        indent: String,
        text: String,
    },
}

/// Сериализационное представление блока (для round-trip в исходный .md)
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlockRaw {
    /// точный отступ строки блока в исходнике
    pub indent_str: String,
    /// "-", "- " — bullet без маркера/контента
    pub bullet: String,
    /// сырой текст маркера и приоритета с разделителями ("DONE  [#B] ")
    pub marker_str: String,
    /// trailing-строки в исходном порядке
    pub trailing: Vec<Trailing>,
    /// пустые строки после блока
    pub blank_after: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub id: Option<uuid::Uuid>,
    /// отступ в уровнях (0 — верхний уровень)
    pub indent: u8,
    /// маркер статуса задачи
    pub status: Option<Status>,
    /// [#A]/[#B]/[#C]
    pub priority: Option<Priority>,
    /// текст блока без маркера/приоритета
    pub content: String,
    /// `key:: value` свойства
    pub props: HashMap<String, String>,
    /// urgency:: / importance:: (свойства как поля)
    pub urgency: Option<Level>,
    pub importance: Option<Level>,
    pub logbook: Vec<Clock>,
    /// ссылки, извлечённые из content: [[..]] и #..
    pub links: Vec<LinkTarget>,
    /// uuid дочерних блоков (для дерева)
    pub children: Vec<uuid::Uuid>,
    /// uuid родителя
    pub parent: Option<uuid::Uuid>,
    #[serde(skip)]
    pub raw: BlockRaw,
}

impl Block {
    pub fn is_task(&self) -> bool {
        self.status.is_some()
            || self.priority.is_some()
            || self.urgency.is_some()
            || self.importance.is_some()
            || self.props.contains_key("deadline")
            || self.props.contains_key("scheduled")
    }

    /// Меняет статус задачи и маркер в raw-фрагменте так, чтобы
    /// round-trip сериализация осталась байт-точной для остального файла.
    pub fn set_status(&mut self, status: Status) {
        let all_markers = [
            "LATER",
            "TODO",
            "DOING",
            "REVIEW",
            "DONE",
            "CANCELED",
            "NOW",
            "BACKLOG",
            "WAITING",
            "WAIT",
            "IN-PROGRESS",
            "STARTED",
            "COMPLETED",
            "CANCELLED",
        ];
        let lead_len = self.raw.marker_str.len() - self.raw.marker_str.trim_start().len();
        let (lead, rest) = self.raw.marker_str.split_at(lead_len);

        let mut tail = rest;
        for m in all_markers {
            if tail.starts_with(m) {
                let after = &tail[m.len()..];
                // поглощаем ровно один пробел после маркера (как в Logseq)
                tail = after.strip_prefix(' ').unwrap_or(after);
                break;
            }
        }

        let marker = status.to_marker();
        self.raw.marker_str = format!("{lead}{marker} {tail}");
        self.status = Some(status);
    }

    /// Важность: явное свойство важнее приоритета [#A]/[#B]/[#C]
    pub fn effective_importance(&self) -> Level {
        self.importance
            .or_else(|| self.priority.map(Priority::importance))
            .unwrap_or_default()
    }

    /// Срочность: явное свойство, иначе автосрочность по deadline
    /// (дедлайн в пределах URGENT_DAYS дней → high)
    pub fn effective_urgency(&self) -> Level {
        if let Some(u) = self.urgency {
            return u;
        }
        if let Some(deadline) = self.props.get("deadline") {
            if deadline_is_soon(deadline, URGENT_DAYS) {
                return Level::High;
            }
        }
        Level::Low
    }

    /// Устанавливает/сбрасывает свойство urgency:: или importance::
    /// и обновляет raw-фрагмент для байт-точной сериализации.
    /// При добавлении свойство вставляется перед :LOGBOOK: (как в Logseq).
    pub fn set_level(&mut self, key: &str, level: Option<Level>) {
        match level {
            Some(l) => {
                let value = level_str(l);
                self.props.insert(key.to_string(), value.clone());
                let existing = self
                    .raw
                    .trailing
                    .iter()
                    .position(|t| matches!(t, Trailing::Prop { key: k, .. } if k == key));
                if let Some(idx) = existing {
                    if let Trailing::Prop { value: v, .. } = &mut self.raw.trailing[idx] {
                        *v = value;
                    }
                } else {
                    let indent = format!("{}  ", self.raw.indent_str);
                    let prop = Trailing::Prop {
                        indent,
                        key: key.to_string(),
                        value: value.clone(),
                    };
                    // перед LOGBOOK, если он есть
                    let pos = self
                        .raw
                        .trailing
                        .iter()
                        .position(|t| matches!(t, Trailing::LogbookStart(_)));
                    match pos {
                        Some(p) => self.raw.trailing.insert(p, prop),
                        None => self.raw.trailing.push(prop),
                    }
                }
            }
            None => {
                self.props.remove(key);
                self.raw
                    .trailing
                    .retain(|t| !matches!(t, Trailing::Prop { key: k, .. } if k == key));
            }
        }
        self.refresh_levels();
    }

    /// Пересчитывает urgency/importance из props
    pub fn refresh_levels(&mut self) {
        self.urgency = self.props.get("urgency").and_then(|v| parse_level(v));
        self.importance = self.props.get("importance").and_then(|v| parse_level(v));
    }

    /// Квадрант матрицы Эйзенхауэра
    pub fn quadrant(&self) -> Quadrant {
        let u = self.effective_urgency();
        let i = self.effective_importance();
        match (u, i) {
            (Level::High, Level::High) => Quadrant::Do,
            (Level::High, _) => Quadrant::Delegate,
            (_, Level::High) => Quadrant::Schedule,
            _ => Quadrant::Drop,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageKind {
    Journal,
    Page,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    /// для журнала — "2026_09_11", для страницы — имя
    pub name: String,
    pub kind: PageKind,
    /// топ-уровневые блоки (uuid)
    pub roots: Vec<uuid::Uuid>,
    /// порядок блоков как в файле
    pub order: Vec<uuid::Uuid>,
    pub mtime: Option<std::time::SystemTime>,
    /// путь к файлу относительно корня графа
    #[serde(default)]
    pub path: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, Default)]
pub struct Graph {
    /// все блоки графа
    pub blocks: HashMap<uuid::Uuid, Block>,
    pub pages: HashMap<String, Page>,
    /// page-name → ссылающиеся блоки (обратные ссылки)
    pub backlinks: HashMap<String, Vec<uuid::Uuid>>,
}
