//! Атомарная запись файлов графа: tmp + fsync + rename.
//! Защищает от частичных записей при сбоях и конфликтов с Syncthing.

use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Записывает файл атомарно: создаёт tmp-файл рядом, fsync, rename.
/// Родительская директория также fsync'ится (для надёжности на ext4).
/// Права исходного файла сохраняются (rename сбрасывает их на umask).
pub fn atomic_write(path: &Path, text: &str) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "graph".to_string());
    let dir = path.parent().unwrap_or_else(|| Path::new("."));

    // pid в имени — два процесса не столкнутся на одном tmp
    let tmp_name = format!(".{file_name}.{}.logtask.tmp", std::process::id());
    let tmp = dir.join(&tmp_name);

    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);

        // сохраняем права исходного файла (rename сбрасывает на umask)
        if let Ok(meta) = std::fs::metadata(path) {
            let _ = std::fs::set_permissions(&tmp, meta.permissions());
        }

        std::fs::rename(&tmp, path)?;

        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        // не оставляем мусорный tmp (его увидит watcher/Syncthing)
        let _ = std::fs::remove_file(&tmp);
    }
    result
}
