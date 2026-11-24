use std::{collections::HashSet, io, path::Path};
use uuid::Uuid;
use super::model::{Block, Graph, Trailing};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchOperation {
    Delete,
    Move { direction: i8 },
    Indent { direction: i8 },
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}

fn subtree(graph: &Graph, id: Uuid, out: &mut Vec<Uuid>) {
    out.push(id);
    if let Some(block) = graph.blocks.get(&id) {
        for child in &block.children {
            subtree(graph, *child, out);
        }
    }
}

fn normalized(graph: &Graph, ids: &[Uuid]) -> io::Result<(String, Vec<Uuid>)> {
    if ids.is_empty() {
        return Err(invalid("пустой список блоков"));
    }
    let mut page_name = None;
    for id in ids {
        let page = graph.block_page.get(id).ok_or_else(|| invalid("блок не найден"))?;
        if page_name.as_ref().is_some_and(|name| name != page) {
            return Err(invalid("блоки принадлежат разным страницам"));
        }
        page_name = Some(page.clone());
    }
    let page = &graph.pages[page_name.as_ref().unwrap()];
    let selected: HashSet<Uuid> = ids.iter().copied().collect();
    let mut roots = Vec::new();
    for id in &page.order {
        if !selected.contains(id) {
            continue;
        }
        let mut parent = graph.blocks[id].parent;
        let mut covered = false;
        while let Some(current) = parent {
            if selected.contains(&current) {
                covered = true;
                break;
            }
            parent = graph.blocks[&current].parent;
        }
        if !covered {
            roots.push(*id);
        }
    }
    Ok((page_name.unwrap(), roots))
}

fn siblings(graph: &Graph, page: &str, id: &Uuid) -> Vec<Uuid> {
    match graph.blocks[id].parent {
        Some(parent) => graph.blocks[&parent].children.clone(),
        None => graph.pages[page].roots.clone(),
    }
}

fn replace_siblings(graph: &mut Graph, page: &str, parent: Option<Uuid>, ids: Vec<Uuid>) {
    match parent {
        Some(parent) => graph.blocks.get_mut(&parent).unwrap().children = ids,
        None => graph.pages.get_mut(page).unwrap().roots = ids,
    }
}

fn shift_tree(graph: &mut Graph, id: Uuid, delta: i8) {
    let mut stack = vec![id];
    while let Some(current) = stack.pop() {
        let block = graph.blocks.get_mut(&current).unwrap();
        block.indent = if delta > 0 { block.indent + 1 } else { block.indent - 1 };
        block.raw.indent_str = "\t".repeat(block.indent as usize);
        stack.extend(block.children.iter().copied());
    }
}

fn move_one(graph: &mut Graph, page: &str, id: Uuid, direction: i8) -> bool {
    let parent = graph.blocks[&id].parent;
    let mut siblings = siblings(graph, page, &id);
    let index = siblings.iter().position(|item| item == &id).unwrap();
    let target = index as isize + direction as isize;
    if target < 0 || target >= siblings.len() as isize {
        return false;
    }
    siblings.swap(index, target as usize);
    replace_siblings(graph, page, parent, siblings);
    true
}

fn indent_one(graph: &mut Graph, page: &str, id: Uuid) -> bool {
    let parent = graph.blocks[&id].parent;
    let mut old_siblings = siblings(graph, page, &id);
    let index = old_siblings.iter().position(|item| item == &id).unwrap();
    if index == 0 {
        return false;
    }
    let new_parent = old_siblings[index - 1];
    old_siblings.remove(index);
    replace_siblings(graph, page, parent, old_siblings);
    graph.blocks.get_mut(&new_parent).unwrap().children.push(id);
    graph.blocks.get_mut(&id).unwrap().parent = Some(new_parent);
    shift_tree(graph, id, 1);
    true
}

fn outdent_one(graph: &mut Graph, page: &str, id: Uuid) -> bool {
    let Some(parent) = graph.blocks[&id].parent else {
        return false;
    };
    let grandparent = graph.blocks[&parent].parent;
    let mut old_siblings = siblings(graph, page, &id);
    old_siblings.retain(|item| item != &id);
    replace_siblings(graph, page, Some(parent), old_siblings);
    let mut new_siblings = siblings(graph, page, &parent);
    let parent_index = new_siblings.iter().position(|item| item == &parent).unwrap();
    new_siblings.insert(parent_index + 1, id);
    replace_siblings(graph, page, grandparent, new_siblings);
    graph.blocks.get_mut(&id).unwrap().parent = grandparent;
    shift_tree(graph, id, -1);
    true
}

fn rebuild_order(graph: &mut Graph, page: &str) {
    let roots = graph.pages[page].roots.clone();
    let mut order = Vec::new();
    for root in roots {
        subtree(graph, root, &mut order);
    }
    graph.pages.get_mut(page).unwrap().order = order;
}

impl Graph {
    pub fn blocks_markdown(&self, ids: &[Uuid]) -> Result<String, String> {
        let (_, roots) = normalized(self, ids).map_err(|e| e.to_string())?;
        let mut out = String::new();
        for root in roots {
            let base = self.blocks[&root].indent;
            let mut ids = Vec::new();
            subtree(self, root, &mut ids);
            for id in ids {
                let mut block: Block = self.blocks[&id].clone();
                let old_prefix = block.raw.indent_str.clone();
                let new_prefix = "\t".repeat((block.indent - base) as usize);
                block.raw.indent_str = new_prefix.clone();
                for item in &mut block.raw.trailing {
                    let indent = match item {
                        Trailing::Prop { indent, .. }
                        | Trailing::LogbookStart(indent)
                        | Trailing::LogbookEnd(indent)
                        | Trailing::Clock { indent, .. }
                        | Trailing::Raw { indent, .. } => indent,
                        Trailing::Blank => continue,
                    };
                    *indent = match indent.strip_prefix(&old_prefix) {
                        Some(suffix) => format!("{new_prefix}{suffix}"),
                        None => format!("{new_prefix}  {}", indent.trim_start()),
                    };
                }
                out.push_str(&block.to_markdown());
            }
        }
        Ok(out)
    }

    pub fn apply_block_batch(
        &mut self,
        ids: &[Uuid],
        operation: BatchOperation,
        root: &Path,
    ) -> io::Result<Option<String>> {
        let (page_name, roots) = normalized(self, ids)?;
        let Some((_, kind, rel_path, abs)) = self.page_io(&roots[0], root)? else {
            return Err(invalid("страница не найдена"));
        };
        if let BatchOperation::Move { direction } | BatchOperation::Indent { direction } = operation {
            if !matches!(direction, -1 | 1) {
                return Err(invalid("направление должно быть -1 или 1"));
            }
        }
        let mut working = self.clone();
        let changed = match operation {
            BatchOperation::Delete => {
                let mut removed = HashSet::new();
                let mut all = Vec::new();
                for id in &roots {
                    subtree(&working, *id, &mut all);
                }
                removed.extend(all.iter().copied());
                for id in &all {
                    working.blocks.remove(id);
                    working.block_page.remove(id);
                }
                for block in working.blocks.values_mut() {
                    block.children.retain(|id| !removed.contains(id));
                }
                let page = working.pages.get_mut(&page_name).unwrap();
                page.roots.retain(|id| !removed.contains(id));
                page.order.retain(|id| !removed.contains(id));
                !all.is_empty()
            }
            BatchOperation::Move { direction } => {
                let ordered: Vec<_> = if direction > 0 { roots.iter().rev().copied().collect() } else { roots.clone() };
                let mut changed = false;
                for id in ordered {
                    changed |= move_one(&mut working, &page_name, id, direction);
                }
                changed
            }
            BatchOperation::Indent { direction } => {
                let ordered: Vec<_> = if direction > 0 { roots.clone() } else { roots.iter().rev().copied().collect() };
                let mut changed = false;
                for id in ordered {
                    changed |= if direction > 0 {
                        indent_one(&mut working, &page_name, id)
                    } else {
                        outdent_one(&mut working, &page_name, id)
                    };
                }
                changed
            }
        };
        if !changed {
            return Ok(None);
        }
        rebuild_order(&mut working, &page_name);
        working.write_page(&page_name, kind, rel_path, abs)?;
        *self = working;
        Ok(Some(page_name))
    }
}
