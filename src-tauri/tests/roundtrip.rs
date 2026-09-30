//! Round-trip тесты на реальных файлах графа Logseq.
//! parse → serialize должны давать байт-в-байт исходный текст.

use std::fs;
use std::path::Path;

use logtask_lib::core::serializer::roundtrip;

fn fixture(rel: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/graph")
        .join(rel);
    fs::read_to_string(path).expect("фикстура должна существовать")
}

fn roundtrip_check(name: &str) {
    let text = fixture(name);
    let serialized = roundtrip(&text);

    if serialized != text {
        let orig: Vec<&str> = text.split('\n').collect();
        let got: Vec<&str> = serialized.split('\n').collect();
        let mut diff_line = 0;
        for (i, (a, b)) in orig.iter().zip(got.iter()).enumerate() {
            if a != b {
                diff_line = i;
                break;
            }
        }
        let orig_tail: String = text
            .chars()
            .rev()
            .take(20)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let got_tail: String = serialized
            .chars()
            .rev()
            .take(20)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        panic!(
            "round-trip {} расходится на строке {}:\n  оригинал: {:?}\n  получили: {:?}\n  (байтов: {} vs {})\n  хвост: {:?} vs {:?}",
            name,
            diff_line + 1,
            orig.get(diff_line),
            got.get(diff_line),
            text.len(),
            serialized.len(),
            orig_tail,
            got_tail
        );
    }
}

#[test]
fn roundtrip_journal_with_logbook() {
    roundtrip_check("journals/2026_09_11.md");
}

#[test]
fn roundtrip_journal_many_clocks() {
    roundtrip_check("journals/2024_11_23.md");
}

#[test]
fn roundtrip_page_with_links_and_props() {
    roundtrip_check("pages/PPDB - TODO.md");
}

#[test]
fn roundtrip_page_with_headings() {
    roundtrip_check("pages/Arch Linux.md");
}

#[test]
#[ignore]
fn dump_diff_journal() {
    let orig = fixture("journals/2026_09_11.md");
    let got = roundtrip(&orig);
    let a: Vec<&str> = orig.split('\n').collect();
    let b: Vec<&str> = got.split('\n').collect();
    println!("orig {} lines, got {} lines", a.len(), b.len());
    let _n = a.len().max(b.len());
    let mut ai = 0usize;
    let mut bi = 0usize;
    let mut shown = 0;
    while ai < a.len() && bi < b.len() && shown < 40 {
        if a[ai] == b[bi] {
            ai += 1;
            bi += 1;
            continue;
        }
        println!("L{}  orig: {:?}", ai + 1, a[ai]);
        println!("L{}   got: {:?}", bi + 1, b[bi]);
        ai += 1;
        bi += 1;
        shown += 1;
    }
    if ai < a.len() {
        println!("=== пропущено в orig с {}:", ai + 1);
        for (k, l) in a[ai..].iter().enumerate().take(12) {
            println!("  +{:?} {}", k, l.len());
        }
    }
    if bi < b.len() {
        println!("=== лишнее в got с {}:", bi + 1);
        for l in b[bi..].iter().take(12) {
            println!("  -{:?}", l.len());
        }
    }
}
