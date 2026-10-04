//! Синхронизация задач с внешними источниками (docs/05-integrations.md).
//! Двусторонняя: fetch → merge → запись страниц; push статусов на сервер.

pub mod config;
pub mod jsonpath;
pub mod secrets;

/// FNV-1a хэш в hex — для ключей keyring и отпечатков блоков
pub(crate) fn fnv1a_hex(data: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn fnv1a_stable() {
        assert_eq!(super::fnv1a_hex(b"logtask"), super::fnv1a_hex(b"logtask"));
        assert_ne!(super::fnv1a_hex(b"a"), super::fnv1a_hex(b"b"));
        assert_eq!(super::fnv1a_hex(b"").len(), 16);
    }
}
