//! Индекс графа: чтение папки, построение in-memory графа,
//! обратные ссылки, теги.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::model::{Block, Graph, LinkTarget, Page, PageKind};
use super::parser::parse_document;

/// Имена журналов: "2026_09_11" — валидная дата
fn journal_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let mut parts = stem.split('_');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    if y.len() == 4
        && m.len() == 2
        && d.len() == 2
        && y.parse::<u16>().is_ok()
        && m.parse::<u8>()
            .map(|m| (1..=12).contains(&m))
            .unwrap_or(false)
        && d.parse::<u8>()
            .map(|d| (1..=31).contains(&d))
            .unwrap_or(false)
    {
        return Some(stem.to_string());
    }
    None
}

/// Результат индексации
#[derive(Debug, Clone)]
pub struct IndexStats {
    pub pages: usize,
    pub journals: usize,
    pub blocks: usize,
    pub tasks: usize,
    pub links: usize,
}

impl Graph {
    /// Индексирует папку графа (journals/ и pages/).
    /// Возвращает статистику. Ошибки чтения отдельных файлов игнорируются
    /// (логируются вызывающим), индексация продолжается.
    pub fn index_dir(&mut self, root: &Path) -> std::io::Result<IndexStats> {
        self.blocks.clear();
        self.pages.clear();
        self.backlinks.clear();

        let journals_dir = root.join("journals");
        let pages_dir = root.join("pages");

        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };

        if journals_dir.is_dir() {
            self.index_subdir(&journals_dir, PageKind::Journal, &mut stats)?;
        }
        if pages_dir.is_dir() {
            self.index_subdir(&pages_dir, PageKind::Page, &mut stats)?;
        }

        // обратные ссылки
        self.rebuild_backlinks();

        Ok(stats)
    }

    fn index_subdir(
        &mut self,
        dir: &Path,
        kind: PageKind,
        stats: &mut IndexStats,
    ) -> std::io::Result<()> {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file() && p.extension().map(|e| e == "md").unwrap_or(false))
            .collect();
        entries.sort();

        for path in entries {
            let name = match kind {
                PageKind::Journal => match journal_name(&path) {
                    Some(n) => n,
                    None => continue,
                },
                PageKind::Page => match path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                },
            };
            if self.pages.contains_key(&name) {
                continue;
            }
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mtime = std::fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok());
            self.index_file_content(&name, kind, &text, mtime, stats);
        }
        Ok(())
    }

    /// Парсит один файл и добавляет блоки в граф
    pub fn index_file_content(
        &mut self,
        name: &str,
        kind: PageKind,
        text: &str,
        mtime: Option<std::time::SystemTime>,
        stats: &mut IndexStats,
    ) {
        let parsed = parse_document(text);
        let mut roots = Vec::new();
        let mut order = Vec::new();

        for block in parsed.blocks {
            let id = block.id.expect("свежий uuid");
            if block.is_task() {
                stats.tasks += 1;
            }
            stats.links += block.links.len();
            if block.parent.is_none() {
                roots.push(id);
            }
            order.push(id);
            self.blocks.insert(id, block);
        }

        match kind {
            PageKind::Journal => stats.journals += 1,
            PageKind::Page => stats.pages += 1,
        }
        stats.blocks += order.len();

        self.pages.insert(
            name.to_string(),
            Page {
                name: name.to_string(),
                kind,
                roots,
                order,
                mtime,
            },
        );
    }

    /// Перестраивает карту обратных ссылок: page-name → блоки, которые ссылаются
    pub fn rebuild_backlinks(&mut self) {
        self.backlinks.clear();
        for (id, block) in &self.blocks {
            for link in &block.links {
                let target = match link {
                    LinkTarget::Page(p) | LinkTarget::Tag(p) => p.clone(),
                    LinkTarget::Block(_) => continue,
                };
                self.backlinks.entry(target).or_default().push(*id);
            }
        }
    }

    /// Блоки-задачи страницы (с сортировкой как в файле)
    pub fn tasks_of_page(&self, page: &str) -> Vec<(Uuid, &Block)> {
        let Some(page) = self.pages.get(page) else {
            return Vec::new();
        };
        page.order
            .iter()
            .filter_map(|id| self.blocks.get(id).map(|b| (*id, b)))
            .filter(|(_, b)| b.is_task())
            .collect()
    }

    /// Все задачи графа (в стабильном порядке: имя страницы, позиция)
    pub fn all_tasks(&self) -> Vec<(Uuid, &Block)> {
        let mut pages: Vec<&String> = self.pages.keys().collect();
        pages.sort();
        let mut out = Vec::new();
        for page in pages {
            out.extend(self.tasks_of_page(page));
        }
        out
    }

    /// Обратные ссылки на страницу: (id блока, его страница)
    pub fn backlinks_of(&self, page: &str) -> Vec<(Uuid, String)> {
        let ids = self.backlinks.get(page).cloned().unwrap_or_default();
        ids.into_iter()
            .filter_map(|id| self.blocks.get(&id).map(|_| (id, self.page_of_block(&id))))
            .collect()
    }

    /// Имя страницы, содержащей блок
    pub fn page_of_block(&self, id: &Uuid) -> String {
        for (name, page) in &self.pages {
            if page.order.contains(id) {
                return name.clone();
            }
        }
        String::new()
    }

    /// Все имена страниц + тегов (для автодополнения [[...]])
    pub fn all_page_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.pages.keys().cloned().collect();
        for target in self.backlinks.keys() {
            if !names.contains(target) {
                names.push(target.clone());
            }
        }
        names.sort();
        names
    }

    /// Полнотекстовый поиск по блокам
    pub fn search(&self, query: &str, limit: usize) -> Vec<(Uuid, String)> {
        let q = query.to_ascii_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let mut out: Vec<(Uuid, String)> = self
            .blocks
            .iter()
            .filter(|(_, b)| b.content.to_ascii_lowercase().contains(&q))
            .map(|(id, b)| (*id, b.content.clone()))
            .take(limit)
            .collect();
        out.sort_by_key(|a| a.1.len());
        out
    }
}
