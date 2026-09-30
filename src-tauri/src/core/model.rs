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
            "DOING" | "IN-PROGRESS" | "STARTED" => Some(Status::Doing),
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

    /// Важность: явное свойство важнее приоритета [#A]/[#B]/[#C]
    pub fn effective_importance(&self) -> Level {
        self.importance
            .or_else(|| self.priority.map(Priority::importance))
            .unwrap_or_default()
    }

    pub fn effective_urgency(&self) -> Level {
        self.urgency.unwrap_or_default()
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
}

#[derive(Debug, Clone, Default)]
pub struct Graph {
    /// все блоки графа
    pub blocks: HashMap<uuid::Uuid, Block>,
    pub pages: HashMap<String, Page>,
    /// page-name → ссылающиеся блоки (обратные ссылки)
    pub backlinks: HashMap<String, Vec<uuid::Uuid>>,
}
