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
        self.block_page.clear();

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
            self.block_page.insert(id, name.to_string());
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

    /// Удаляет блок из всех индексов
    fn remove_block(&mut self, id: &Uuid) {
        self.blocks.remove(id);
        self.block_page.remove(id);
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
                self.remove_block(&old);
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
        self.block_page.get(id).cloned().unwrap_or_default()
    }

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

    /// Меняет текст блока целиком (контент + строки-продолжения, см.
    /// Block::set_source)
    pub fn set_block_text(
        &mut self,
        id: &Uuid,
        content: &str,
        root: &Path,
    ) -> std::io::Result<Option<String>> {
        self.mutate_block(id, root, |b| b.set_source(content))
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
            self.remove_block(r);
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

    /// Склеивает блок с блоком выше (Backspace в начале блока, как в Logseq):
    /// текст дописывается в конец вышестоящего, дочерние переезжают к нему,
    /// текущий блок удаляется. Вышестоящий — предыдущий в порядке документа.
    /// Первому блоку страницы склеиваться не с кем → Ok(None).
    /// Возвращает (страница, позиция выжившего блока в порядке документа) —
    /// uuid после перезаписи страницы и полной переиндексации меняются
    /// дважды, поэтому наружу отдаём позицию, а uuid вычисляет команда
    /// уже по финальному графу.
    pub fn merge_block_up(
        &mut self,
        id: &Uuid,
        root: &Path,
    ) -> std::io::Result<Option<(String, usize)>> {
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
        check_mtime(&abs, mtime)?;

        let page = &self.pages[&page_name];
        let Some(pos) = page.order.iter().position(|x| x == id) else {
            return Ok(None);
        };
        if pos == 0 {
            return Ok(None); // первому блоку не с кем склеиваться
        }
        let prev_id = page.order[pos - 1];

        // данные текущего блока
        let (cur_content, cur_trailing, cur_children, cur_indent, cur_indent_str, cur_parent) = {
            let b = &self.blocks[id];
            (
                b.content.clone(),
                b.raw.trailing.clone(),
                b.children.clone(),
                b.indent,
                b.raw.indent_str.clone(),
                b.parent,
            )
        };
        let (pred_indent, pred_indent_str) = {
            let b = &self.blocks[&prev_id];
            (b.indent, b.raw.indent_str.clone())
        };

        // единица отступа поддерева: из первого ребёнка, иначе tab
        let unit = cur_children
            .first()
            .and_then(|c| self.blocks.get(c))
            .and_then(|c| c.raw.indent_str.strip_prefix(&cur_indent_str))
            .unwrap_or("\t")
            .to_string();
        let old_prefix = format!("{cur_indent_str}{unit}");
        let new_prefix = format!("{pred_indent_str}{unit}");

        // текст дописываем в вышестоящий (через пробел, если оба непустые)
        {
            let prev = self.blocks.get_mut(&prev_id).expect("prev блок");
            let joined = match (
                prev.content.trim_end().is_empty(),
                cur_content.trim().is_empty(),
            ) {
                (true, true) => String::new(),
                (true, false) => cur_content.trim().to_string(),
                (false, true) => prev.content.clone(),
                (false, false) => format!("{} {}", prev.content.trim_end(), cur_content.trim()),
            };
            prev.set_content(&joined);
            prev.raw.trailing.extend(cur_trailing);
            prev.children.extend(cur_children.iter().copied());
        }

        // поддерево переезжает: уровни и отступы сдвигаются к новому родителю
        let mut descendants = cur_children.clone();
        let mut stack = cur_children.clone();
        while let Some(c) = stack.pop() {
            if let Some(b) = self.blocks.get(&c) {
                stack.extend(b.children.iter().copied());
                descendants.extend(b.children.iter().copied());
            }
        }
        for d in descendants {
            let Some(b) = self.blocks.get_mut(&d) else {
                continue;
            };
            b.indent = pred_indent + (b.indent - cur_indent);
            let suffix = b
                .raw
                .indent_str
                .strip_prefix(&old_prefix)
                .unwrap_or("")
                .to_string();
            b.raw.indent_str = format!("{new_prefix}{suffix}");
            if cur_children.contains(&d) {
                b.parent = Some(prev_id);
            }
        }

        // текущий блок удаляется (дети уже перепривязаны)
        self.remove_block(id);
        if let Some(p) = cur_parent.and_then(|p| self.blocks.get_mut(&p)) {
            p.children.retain(|x| x != id);
        }
        if let Some(page) = self.pages.get_mut(&page_name) {
            page.order.retain(|x| x != id);
            page.roots.retain(|x| x != id);
        }

        let page_snapshot = self.pages[&page_name].clone();
        let text = super::serializer::serialize_page(&page_snapshot, &self.blocks);
        if let Err(e) = super::fswrite::atomic_write(&abs, &text) {
            self.reload_page(&page_name, kind, &abs, Some(rel_path.clone()));
            return Err(e);
        }
        self.reload_page(&page_name, kind, &abs, Some(rel_path));
        // выживший блок остался на позиции prev (pos - 1)
        Ok(Some((page_name, pos - 1)))
    }

    /// Склеивание с нижестоящим блоком (Delete в конце блока): нижестоящий
    /// присоединяется к текущему — это merge_block_up для следующего блока
    /// в порядке документа.
    pub fn merge_block_down(
        &mut self,
        id: &Uuid,
        root: &Path,
    ) -> std::io::Result<Option<(String, usize)>> {
        let page_name = self.page_of_block(id);
        let Some(page) = self.pages.get(&page_name) else {
            return Ok(None);
        };
        let Some(pos) = page.order.iter().position(|x| x == id) else {
            return Ok(None);
        };
        let Some(&next) = page.order.get(pos + 1) else {
            return Ok(None); // последнему блоку не с кем склеиваться
        };
        self.merge_block_up(&next, root)
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
        self.block_page.insert(id, page_name.to_string());
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
    /// Переименовывает страницу: файл pages/<old>.md → pages/<new>.md и
    /// переписывает ссылки на неё (`[[old]]`, `[[old|alias]]`, `#old`) во
    /// всех затронутых файлах графа (по индексу обратных ссылок).
    /// Индекс не перестраивает — это делает вызывающий (reindex_and_emit).
    pub fn rename_page(&mut self, old: &str, new: &str, root: &Path) -> std::io::Result<()> {
        let invalid =
            |msg: &str| std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.to_string());

        let new = new.trim();
        if new.is_empty() {
            return Err(invalid("имя страницы не может быть пустым"));
        }
        if new.contains('/') || new.contains('\\') {
            return Err(invalid("имя страницы не может содержать / и \\"));
        }
        let Some(page) = self.pages.get(old) else {
            return Err(invalid("страница не найдена"));
        };
        if page.kind != PageKind::Page {
            return Err(invalid("журналы нельзя переименовывать"));
        }
        if self.pages.contains_key(new) {
            return Err(invalid("страница с таким именем уже существует"));
        }

        let old_rel = page
            .path
            .clone()
            .unwrap_or_else(|| default_rel_path(old, page.kind));
        let new_rel = default_rel_path(new, PageKind::Page);
        let old_abs = root.join(&old_rel);
        let new_abs = root.join(&new_rel);
        if new_abs.exists() {
            return Err(invalid("файл с таким именем уже существует"));
        }

        // затронутые страницы — из обратных ссылок (включая self-ссылки)
        let mut affected: Vec<String> = Vec::new();
        if let Some(ids) = self.backlinks.get(old) {
            for id in ids {
                let page_name = self.page_of_block(id);
                if !page_name.is_empty() && !affected.contains(&page_name) {
                    affected.push(page_name);
                }
            }
        }

        std::fs::rename(&old_abs, &new_abs)?;

        for name in affected {
            let Some(p) = self.pages.get(&name) else {
                continue;
            };
            let abs = if name == old {
                new_abs.clone()
            } else {
                let rel = p
                    .path
                    .clone()
                    .unwrap_or_else(|| default_rel_path(&p.name, p.kind));
                root.join(rel)
            };
            let Ok(text) = std::fs::read_to_string(&abs) else {
                continue;
            };
            let updated = super::rename::replace_refs(&text, old, new);
            if updated != text {
                super::fswrite::atomic_write(&abs, &updated)?;
            }
        }

        Ok(())
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

    /// Полнотекстовый поиск по блокам (без учёта регистра, Unicode-aware)
    pub fn search(&self, query: &str, limit: usize) -> Vec<(Uuid, String)> {
        let q = query.to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }
        let mut out: Vec<(Uuid, String)> = self
            .blocks
            .iter()
            .filter(|(_, b)| b.content.to_lowercase().contains(&q))
            .map(|(id, b)| (*id, b.content.clone()))
            .collect();
        // сначала сортировка (короткие релевантнее), потом лимит — детерминированно
        out.sort_by(|a, b| a.1.len().cmp(&b.1.len()).then_with(|| a.1.cmp(&b.1)));
        out.truncate(limit);
        out
    }
}
