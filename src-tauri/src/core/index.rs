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
            self.index_subdir(root, &journals_dir, PageKind::Journal, &mut stats)?;
        }
        if pages_dir.is_dir() {
            self.index_subdir(root, &pages_dir, PageKind::Page, &mut stats)?;
        }

        // обратные ссылки
        self.rebuild_backlinks();

        Ok(stats)
    }

    fn index_subdir(
        &mut self,
        root: &Path,
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
            let rel_path = path.strip_prefix(root).ok().map(|p| p.to_path_buf());
            self.index_file_content(&name, kind, &text, mtime, stats, rel_path);
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
        path: Option<PathBuf>,
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
                preamble: parsed.preamble,
                trailing_blank: parsed.trailing_blank,
                ends_with_newline: parsed.ends_with_newline,
                mtime,
                path,
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

    /// Перечитывает файл страницы с диска и переиндексирует её
    /// (заменяет блоки страницы и перестраивает обратные ссылки).
    /// Используется и после успешной записи, и для восстановления памяти
    /// после неудачной (чтобы граф не расходился с файлом).
    fn reload_page(&mut self, name: &str, kind: PageKind, abs: &Path, rel_path: Option<PathBuf>) {
        if let Some(page) = self.pages.get(name) {
            let old_order = page.order.clone();
            for old in old_order {
                self.blocks.remove(&old);
            }
        }
        let Ok(text) = std::fs::read_to_string(abs) else {
            return;
        };
        let mtime = std::fs::metadata(abs).ok().and_then(|m| m.modified().ok());
        let mut stats = IndexStats {
            pages: 0,
            journals: 0,
            blocks: 0,
            tasks: 0,
            links: 0,
        };
        self.index_file_content(name, kind, &text, mtime, &mut stats, rel_path);
        self.rebuild_backlinks();
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

    /// Меняет статус задачи и перезаписывает файл страницы на диск.
    /// После записи файл переиндексируется (блоки/ссылки/обратные ссылки).
    /// Возвращает имя страницы, если блок найден и сохранён.
    /// Применяет функцию к блоку и перезаписывает файл страницы на диск.
    /// Перед записью проверяет mtime файла — если он изменился извне
    /// (Syncthing/Logseq), возвращает Err, чтобы не затереть чужие правки.
    /// После записи файл переиндексируется (блоки/ссылки/обратные ссылки).
    /// Возвращает имя страницы, если блок найден и сохранён.
    pub fn mutate_block<F>(
        &mut self,
        id: &Uuid,
        root: &Path,
        f: F,
    ) -> std::io::Result<Option<String>>
    where
        F: FnOnce(&mut super::model::Block),
    {
        let page_name = self.page_of_block(id);
        if page_name.is_empty() {
            return Ok(None);
        }

        // f меняет только блок, не структуру страницы — снимок остаётся свежим
        let Some(page_snapshot) = self.pages.get(&page_name).cloned() else {
            return Ok(None);
        };
        let kind = page_snapshot.kind;
        let rel_path = page_snapshot
            .path
            .clone()
            .unwrap_or_else(|| default_rel_path(&page_snapshot.name, page_snapshot.kind));

        let abs = root.join(&rel_path);

        // защита от перезаписи чужих правок
        check_mtime(&abs, page_snapshot.mtime)?;

        let Some(block) = self.blocks.get_mut(id) else {
            return Ok(None);
        };
        f(block);

        let text = super::serializer::serialize_page(&page_snapshot, &self.blocks);
        if let Err(e) = super::fswrite::atomic_write(&abs, &text) {
            // память уже изменена — перечитываем страницу с диска, чтобы
            // in-memory граф не расходился с файлом
            self.reload_page(&page_name, kind, &abs, Some(rel_path.clone()));
            return Err(e);
        }

        // переиндексация этой страницы: удалить старые блоки и добавить новые
        self.reload_page(&page_name, kind, &abs, Some(rel_path));

        Ok(Some(page_name))
    }

    /// Меняет статус задачи (drag&drop в канбане).
    pub fn set_block_status(
        &mut self,
        id: &Uuid,
        status: super::model::Status,
        root: &Path,
    ) -> std::io::Result<Option<String>> {
        self.mutate_block(id, root, |b| b.set_status(status))
    }

    /// Меняет срочность/важность задачи (drag&drop в матрице).
    /// None — оставляет свойство как есть (явный сброс через set_level).
    pub fn set_block_quadrant(
        &mut self,
        id: &Uuid,
        urgency: Option<super::model::Level>,
        importance: Option<super::model::Level>,
        root: &Path,
    ) -> std::io::Result<Option<String>> {
        self.mutate_block(id, root, |b| {
            if let Some(u) = urgency {
                b.set_level("urgency", Some(u));
            }
            if let Some(i) = importance {
                b.set_level("importance", Some(i));
            }
        })
    }

    /// Меняет текст блока
    pub fn set_block_text(
        &mut self,
        id: &Uuid,
        content: &str,
        root: &Path,
    ) -> std::io::Result<Option<String>> {
        self.mutate_block(id, root, |b| b.set_content(content))
    }

    /// Удаляет блок и его дочерние блоки
    pub fn delete_block(&mut self, id: &Uuid, root: &Path) -> std::io::Result<Option<String>> {
        let page_name = self.page_of_block(id);
        if page_name.is_empty() {
            return Ok(None);
        }
        let (kind, rel_path, mtime) = {
            let Some(page) = self.pages.get(&page_name) else {
                return Ok(None);
            };
            (
                page.kind,
                page.path
                    .clone()
                    .unwrap_or_else(|| default_rel_path(&page.name, page.kind)),
                page.mtime,
            )
        };
        let abs = root.join(&rel_path);

        // защита от перезаписи чужих правок — до любых мутаций памяти
        check_mtime(&abs, mtime)?;

        // собираем удаляемое поддерево
        let mut to_remove: Vec<Uuid> = vec![*id];
        let mut stack = vec![*id];
        while let Some(cur) = stack.pop() {
            if let Some(b) = self.blocks.get(&cur) {
                stack.extend(b.children.iter().copied());
                to_remove.extend(b.children.iter().copied());
            }
        }
        for r in &to_remove {
            self.blocks.remove(r);
        }
        if let Some(page) = self.pages.get_mut(&page_name) {
            page.order.retain(|x| !to_remove.contains(x));
            page.roots.retain(|x| !to_remove.contains(x));
        }

        let page_snapshot = self.pages[&page_name].clone();
        let text = super::serializer::serialize_page(&page_snapshot, &self.blocks);
        if let Err(e) = super::fswrite::atomic_write(&abs, &text) {
            // память уже изменена — перечитываем страницу с диска, чтобы
            // in-memory граф не расходился с файлом
            self.reload_page(&page_name, kind, &abs, Some(rel_path.clone()));
            return Err(e);
        }

        self.reload_page(&page_name, kind, &abs, Some(rel_path));
        Ok(Some(page_name))
    }

    /// Добавляет новый блок в конец страницы (корневой уровень).
    /// Возвращает uuid нового блока.
    pub fn append_block(
        &mut self,
        page_name: &str,
        content: &str,
        status: Option<super::model::Status>,
        root: &Path,
    ) -> std::io::Result<Option<Uuid>> {
        let Some(page) = self.pages.get(page_name) else {
            return Ok(None);
        };
        let (kind, rel_path, mtime) = (
            page.kind,
            page.path
                .clone()
                .unwrap_or_else(|| default_rel_path(&page.name, page.kind)),
            page.mtime,
        );
        let abs = root.join(&rel_path);

        // защита от перезаписи чужих правок — до любых мутаций памяти
        check_mtime(&abs, mtime)?;

        let mut block = super::serializer::new_block(content.to_string(), 0);
        if let Some(s) = status {
            block.set_status(s);
        } else {
            // обычный блок без маркера
            block.status = None;
            block.raw.marker_str = String::new();
        }
        let id = block.id.expect("свежий uuid");
        self.blocks.insert(id, block);
        if let Some(page) = self.pages.get_mut(page_name) {
            page.roots.push(id);
            page.order.push(id);
        }

        let page_snapshot = self.pages[page_name].clone();
        let text = super::serializer::serialize_page(&page_snapshot, &self.blocks);
        if let Err(e) = super::fswrite::atomic_write(&abs, &text) {
            // память уже изменена — перечитываем страницу с диска, чтобы
            // in-memory граф не расходился с файлом
            self.reload_page(page_name, kind, &abs, Some(rel_path.clone()));
            return Err(e);
        }

        self.reload_page(page_name, kind, &abs, Some(rel_path));
        // uuid пересоздаётся при переиндексации (Logseq не хранит его в .md),
        // поэтому находим свежий блок по содержанию
        let new_id = self
            .pages
            .get(page_name)
            .and_then(|p| p.order.last().copied())
            .filter(|id| {
                self.blocks
                    .get(id)
                    .map(|b| b.content == content)
                    .unwrap_or(false)
            });
        Ok(new_id)
    }
}

/// Err, если файл на диске новее прочитанного (внешняя правка)
fn check_mtime(abs: &Path, known: Option<std::time::SystemTime>) -> std::io::Result<()> {
    if let Some(known) = known {
        if let Ok(actual) = std::fs::metadata(abs).and_then(|m| m.modified()) {
            if actual != known {
                return Err(std::io::Error::other(
                    "файл изменён другим приложением — обнови граф",
                ));
            }
        }
    }
    Ok(())
}

/// Путь к файлу страницы по умолчанию: journals/<name>.md или pages/<name>.md
fn default_rel_path(name: &str, kind: super::model::PageKind) -> PathBuf {
    match kind {
        super::model::PageKind::Journal => PathBuf::from("journals").join(format!("{name}.md")),
        super::model::PageKind::Page => PathBuf::from("pages").join(format!("{name}.md")),
    }
}

impl Graph {
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
