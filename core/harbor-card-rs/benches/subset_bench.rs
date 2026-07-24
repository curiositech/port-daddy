//! Criterion baseline for the two harbor-card leaf primitives that sit on the
//! live production path: `verify_capability_subset` (called by `lib/arbiter.ts`
//! `checkCapEscalation` on every `LOCK_ACQUIRE`) and `constant_time_compare`.
//!
//! Realistic cap lists are small (a handful of capability strings), so the
//! benchmark uses sizes drawn from real capability sets, not pathological ones —
//! the question is whether the O(n·m) linear scan is actually a cost at these
//! sizes or already negligible. Run:
//! `cargo bench --bench subset_bench` (from core/harbor-card-rs).

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use harbor_card_rs::HarborCardVerifier;
use std::hint::black_box;

fn caps(prefix: &str, n: usize) -> Vec<String> {
    (0..n).map(|i| format!("{prefix}:cap:{i:02}")).collect()
}

/// Subset check across realistic capability-set sizes. `root` holds the full
/// grant; `sub` is the (equal-or-narrower) attenuated set an agent presents.
/// The worst case for the linear scan is when every `sub` cap is present and
/// sits late in `root`, so we build `sub` from the tail of `root`.
fn bench_subset(c: &mut Criterion) {
    let mut group = c.benchmark_group("verify_capability_subset");
    for &(rn, sn) in &[(4usize, 2usize), (12, 6), (32, 16)] {
        let root = caps("harbor", rn);
        // sub = last `sn` of root (all present → full scan, no early false exit).
        let sub: Vec<String> = root.iter().rev().take(sn).cloned().collect();
        assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("root{rn}_sub{sn}")),
            &(root, sub),
            |b, (root, sub)| {
                b.iter(|| HarborCardVerifier::verify_capability_subset(black_box(root), black_box(sub)));
            },
        );
    }
    group.finish();
}

/// The constant-time comparator on the tag sizes it actually sees: 32-byte MAC
/// tags and 64-byte Ed25519 signatures. Fold-XOR over a fixed length should
/// already be near-optimal; this confirms it rather than assuming.
fn bench_ct_compare(c: &mut Criterion) {
    let mut group = c.benchmark_group("constant_time_compare");
    for &len in &[32usize, 64] {
        let a = vec![0x5Au8; len];
        let mut b_eq = a.clone();
        // Flip the last byte for the "differ at the end" (worst timing) case.
        let mut b_ne = a.clone();
        *b_ne.last_mut().unwrap() ^= 0xFF;
        let _ = &mut b_eq;
        group.bench_with_input(BenchmarkId::new("equal", len), &(a.clone(), b_eq), |bn, (a, b)| {
            bn.iter(|| HarborCardVerifier::constant_time_compare(black_box(a), black_box(b)));
        });
        group.bench_with_input(BenchmarkId::new("differ_last", len), &(a, b_ne), |bn, (a, b)| {
            bn.iter(|| HarborCardVerifier::constant_time_compare(black_box(a), black_box(b)));
        });
    }
    group.finish();
}

criterion_group!(benches, bench_subset, bench_ct_compare);
criterion_main!(benches);
