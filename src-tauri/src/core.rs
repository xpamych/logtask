//! ядро Logtask: парсер outliner, модель, индекс (Фаза 1)

#[allow(dead_code)]
pub fn core_smoke() -> &'static str {
    "logtask-core"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        assert_eq!(core_smoke(), "logtask-core");
    }
}
