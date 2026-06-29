//! Criterion benchmark: naive vs. allocation-disciplined word counting.
//!
//!   cargo bench
//!
//! Criterion warms up, takes many samples, and reports a confidence interval
//! plus regression vs. the last run. Do not eyeball a single `Instant::now()`
//! delta — that is the #1 benchmarking mistake (see references/01).

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use wordcount_perf::{word_counts_disciplined, word_counts_naive};

/// Build a deterministic ~realistic corpus: a few thousand words with a
/// Zipf-ish repeat distribution so the HashMap actually gets reuse.
fn corpus() -> String {
    let lexicon = [
        "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
        "performance", "rust", "allocation", "iterator", "cache", "simd",
        "async", "mutex", "channel", "borrow", "lifetime", "profile",
    ];
    let mut s = String::new();
    // 50k words, repeating the lexicon with punctuation noise.
    for i in 0..50_000 {
        let w = lexicon[(i * 2654435761usize >> 11) % lexicon.len()];
        if i % 7 == 0 {
            s.push_str(&w.to_uppercase());
            s.push_str(". ");
        } else if i % 11 == 0 {
            s.push_str(w);
            s.push_str("; ");
        } else {
            s.push_str(w);
            s.push(' ');
        }
    }
    s
}

fn bench(c: &mut Criterion) {
    let text = corpus();
    let mut group = c.benchmark_group("word_counts");
    group.throughput(Throughput::Bytes(text.len() as u64));

    group.bench_function("naive", |b| {
        b.iter(|| word_counts_naive(black_box(&text)))
    });
    group.bench_function("disciplined", |b| {
        b.iter(|| word_counts_disciplined(black_box(&text)))
    });

    group.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
