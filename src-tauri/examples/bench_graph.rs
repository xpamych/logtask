use logtask_lib::core::model::Graph;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    let root = PathBuf::from("/path/to/graph");
    // прогрев
    let mut g = Graph::default();
    let _ = g.index_dir(&root);

    let mut best = f64::INFINITY;
    for _ in 0..5 {
        let t0 = Instant::now();
        let mut graph = Graph::default();
        let stats = graph.index_dir(&root).expect("index");
        let elapsed = t0.elapsed().as_secs_f64() * 1000.0;
        if elapsed < best {
            best = elapsed;
        }
        println!(
            "files=706 blocks={} tasks={} backlinks={} {:.1}ms",
            stats.blocks,
            stats.tasks,
            graph.backlinks.len(),
            elapsed
        );
    }
    println!("BEST: {best:.1}ms");
}
