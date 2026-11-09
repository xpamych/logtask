//! Производный бинарный снимок индекса. Источником истины остаются md-файлы.

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::index::IndexStats;
use super::model::{Graph, PageKind};

const FORMAT_VERSION: u32 = 2;
const CACHE_REL_PATH: &str = ".logtask/index-cache.bin";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileStamp {
    path: PathBuf,
    size: u64,
    mtime: Option<SystemTime>,
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    files: Vec<FileStamp>,
    graph: Graph,
    stats: IndexStats,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    checksum: u64,
    payload: Vec<u8>,
}

pub fn load(root: &Path) -> Option<(Graph, IndexStats)> {
    let envelope: Envelope =
        bincode::deserialize(&std::fs::read(root.join(CACHE_REL_PATH)).ok()?).ok()?;
    if envelope.version != FORMAT_VERSION || checksum(&envelope.payload) != envelope.checksum {
        return None;
    }
    let snapshot: Snapshot = bincode::deserialize(&envelope.payload).ok()?;
    if snapshot.files != manifest(root)? {
        return None;
    }
    Some((snapshot.graph, snapshot.stats))
}

pub fn save(root: &Path, graph: &Graph, stats: &IndexStats) {
    let Some(files) = manifest(root) else {
        return;
    };
    save_if_unchanged(root, graph, stats, files);
}

pub(crate) fn save_if_unchanged(
    root: &Path,
    graph: &Graph,
    stats: &IndexStats,
    files: Vec<FileStamp>,
) {
    if manifest(root).as_ref() != Some(&files) {
        return;
    }
    let snapshot = Snapshot {
        files,
        graph: graph.clone(),
        stats: stats.clone(),
    };
    let Ok(payload) = bincode::serialize(&snapshot) else {
        return;
    };
    let envelope = Envelope {
        version: FORMAT_VERSION,
        checksum: checksum(&payload),
        payload,
    };
    let Ok(bytes) = bincode::serialize(&envelope) else {
        return;
    };
    let path = root.join(CACHE_REL_PATH);
    if std::fs::create_dir_all(path.parent().expect("каталог кэша")).is_err() {
        return;
    }
    let _ = super::fswrite::atomic_write_bytes(&path, &bytes);
}

fn checksum(bytes: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn manifest(root: &Path) -> Option<Vec<FileStamp>> {
    let mut files = Vec::new();
    for (dir, kind) in [
        (root.join("journals"), PageKind::Journal),
        (root.join("pages"), PageKind::Page),
    ] {
        if !dir.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(dir).ok()? {
            let path = entry.ok()?.path();
            if !path.is_file()
                || path
                    .extension()
                    .map(|extension| extension != "md")
                    .unwrap_or(true)
            {
                continue;
            }
            if kind == PageKind::Journal && super::index::journal_name(&path).is_none() {
                continue;
            }
            if kind == PageKind::Page && path.file_stem().and_then(|stem| stem.to_str()).is_none() {
                continue;
            }
            let metadata = std::fs::metadata(&path).ok()?;
            files.push(FileStamp {
                path: path.strip_prefix(root).ok()?.to_path_buf(),
                size: metadata.len(),
                mtime: metadata.modified().ok(),
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Some(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_manifest_prevents_cache_save() {
        let root = std::env::temp_dir().join(format!("logtask-cache-race-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("pages")).unwrap();
        std::fs::write(root.join("pages/Пример.md"), "- до\n").unwrap();
        let before = manifest(&root).unwrap();
        std::fs::write(root.join("pages/Пример.md"), "- после\n").unwrap();

        save_if_unchanged(
            &root,
            &Graph::default(),
            &IndexStats {
                pages: 0,
                journals: 0,
                blocks: 0,
                tasks: 0,
                links: 0,
            },
            before,
        );

        assert!(!root.join(CACHE_REL_PATH).exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
