//! Атомарная запись файлов графа: tmp + fsync + rename.
//! Защищает от частичных записей при сбоях и конфликтов с Syncthing.

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TMP_ID: AtomicU64 = AtomicU64::new(0);

/// Записывает файл атомарно: создаёт tmp-файл рядом, fsync, rename.
/// Родительская директория также fsync'ится (для надёжности на ext4).
/// Права исходного файла сохраняются (rename сбрасывает их на umask).
pub fn atomic_write(path: &Path, text: &str) -> std::io::Result<()> {
    atomic_write_bytes(path, text.as_bytes())
}

pub fn atomic_write_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
    atomic_write_bytes_with_ops(
        path,
        data,
        |tmp, original| {
            if let Ok(meta) = std::fs::metadata(original) {
                std::fs::set_permissions(tmp, meta.permissions())?;
            }
            Ok(())
        },
        |dir| {
            #[cfg(unix)]
            {
                let d = File::open(dir)?;
                d.sync_all()?;
            }
            Ok(())
        },
    )
}

pub(crate) fn atomic_write_bytes_with_ops<F, G>(
    path: &Path,
    data: &[u8],
    mut set_permissions: F,
    sync_dir: G,
) -> std::io::Result<()>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
    G: FnOnce(&Path) -> std::io::Result<()>,
{
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "graph".to_string());
    let dir = path.parent().unwrap_or_else(|| Path::new("."));

    let tmp_name = format!(
        ".{file_name}.{}-{}.logtask.tmp",
        std::process::id(),
        NEXT_TMP_ID.fetch_add(1, Ordering::Relaxed)
    );
    let tmp = dir.join(&tmp_name);

    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);

        set_permissions(&tmp, path)?;
        std::fs::rename(&tmp, path)?;
        sync_dir(dir)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Создаёт пустую структуру графа с нуля: сам каталог + `journals/` +
/// `pages/`. Идемпотентно: существующие каталоги и файлы не трогаются.
pub fn scaffold_graph(root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(root.join("journals"))?;
    std::fs::create_dir_all(root.join("pages"))?;
    Ok(())
}
