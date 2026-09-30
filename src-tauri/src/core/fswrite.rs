//! Атомарная запись файлов графа: tmp + fsync + rename.
//! Защищает от частичных записей при сбоях и конфликтов с Syncthing.

use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Записывает файл атомарно: создаёт tmp-файл рядом, fsync, rename.
/// Родительская директория также fsync'ится (для надёжности на ext4).
pub fn atomic_write(path: &Path, text: &str) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "graph".to_string());
    let dir = path.parent().unwrap_or_else(|| Path::new("."));

    let tmp_name = format!(".{file_name}.logtask.tmp");
    let tmp = dir.join(&tmp_name);

    let mut f = File::create(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);

    // rename атомарен на одной файловой системе
    std::fs::rename(&tmp, path)?;

    // fsync директории, чтобы rename "закрепился" на диске
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
        drop(d);
    }

    Ok(())
}
