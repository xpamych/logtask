use std::path::{Component, Path, PathBuf};

use super::model::Graph;

pub fn graph_name(root: &Path) -> std::io::Result<String> {
    root.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "не удалось определить имя графа"))
}

pub fn canonical_page_name(root: &Path, local: &str) -> std::io::Result<String> {
    Ok(format!("{}/{}", graph_name(root)?, local))
}

pub fn local_page_name(root: &Path, target: &str) -> Option<String> {
    let graph = graph_name(root).ok()?;
    let prefix = format!("{graph}/");
    Some(target.strip_prefix(&prefix).unwrap_or(target).to_string())
}

pub fn validate_relative_path(path: &str, allow_empty: bool) -> std::io::Result<PathBuf> {
    let invalid = || {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("недопустимое имя или путь: {path}"),
        )
    };
    if path.contains('\\')
        || (!allow_empty && path.is_empty())
        || path.split('/').any(|part| part.is_empty() || part == ".")
    {
        return Err(invalid());
    }
    if allow_empty && path.is_empty() {
        return Ok(PathBuf::new());
    }
    let parsed = PathBuf::from(path);
    if parsed.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err(invalid());
    }
    Ok(parsed)
}

pub fn stored_page_name(graph: &Graph, root: &Path, name: &str, prefix: bool) -> String {
    let local = local_page_name(root, name).unwrap_or_else(|| name.to_string());
    let exists = if prefix {
        graph.pages.keys().any(|page| page.starts_with(&local))
    } else {
        graph.pages.contains_key(&local)
    };
    if exists {
        canonical_page_name(root, &local).unwrap_or(name.to_string())
    } else {
        name.to_string()
    }
}

pub fn resolve_local_page_name(graph: &Graph, root: &Path, target: &str) -> Option<String> {
    if graph.pages.contains_key(target) {
        return Some(target.to_string());
    }
    let local = local_page_name(root, target)?;
    graph.pages.contains_key(&local).then_some(local)
}

pub(crate) fn path_to_slashes(path: &Path) -> Option<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

pub(crate) fn markdown_files(dir: &Path, recursive: bool) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_markdown_files(dir, recursive, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_markdown_files(
    dir: &Path,
    recursive: bool,
    files: &mut Vec<PathBuf>,
) -> std::io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if recursive {
                collect_markdown_files(&path, true, files)?;
            }
        } else if file_type.is_file() && path.extension().is_some_and(|ext| ext == "md") {
            files.push(path);
        }
    }
    Ok(())
}
