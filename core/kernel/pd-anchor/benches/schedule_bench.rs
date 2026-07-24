//! Criterion baseline for the CPM scheduler (`schedule`) and the ladder
//! validator (`validate_ladder`) on realistic roadmap-shaped DAGs.
//!
//! "Realistic" here means a layered DAG with genuine fan-out/fan-in and
//! dependency depth — the shape a real roadmap/task graph feeds the daemon's
//! Gantt scheduler, not a 3-node toy. The generator is deterministic (a tiny
//! LCG seeded per size) so the input is fixed across runs and the benchmark
//! isolates the algorithm, not the RNG.
//!
//! Run: `cargo bench -p pd-anchor --bench schedule_bench`

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use pd_anchor::schedule::{schedule, validate_ladder, LadderNode, ParentEdge, SchedEdge, SchedNode};
use std::hint::black_box;

/// Deterministic linear-congruential generator — no rand dependency, fixed
/// output for a given seed so every benchmark run sees the identical DAG.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        // Numerical Recipes constants.
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() >> 33) as usize % n.max(1)
    }
}

/// Build a layered DAG: `layers` ranks of `width` nodes each, where every node
/// draws 1–3 predecessors from the immediately preceding layer plus an
/// occasional longer back-edge to an earlier layer (real dependency depth).
/// Ids are zero-padded so lexicographic order is stable and non-trivial (the
/// scheduler orders everything by id).
fn layered_dag(layers: usize, width: usize) -> (Vec<SchedNode>, Vec<SchedEdge>) {
    let mut rng = Lcg(0x9E3779B97F4A7C15 ^ ((layers as u64) << 16 ^ width as u64));
    let mut nodes = Vec::with_capacity(layers * width);
    let mut edges = Vec::new();
    let id = |l: usize, w: usize| format!("n{l:03}-{w:03}");

    for l in 0..layers {
        for w in 0..width {
            let est = 1 + rng.below(8) as i64; // 1..=8 effort units
            nodes.push(SchedNode { id: id(l, w), estimate: Some(est) });
            if l == 0 {
                continue;
            }
            // 1..=3 predecessors from the previous layer.
            let fanin = 1 + rng.below(3);
            for _ in 0..fanin {
                let pw = rng.below(width);
                edges.push(SchedEdge { from: id(l - 1, pw), to: id(l, w) });
            }
            // ~1-in-4 nodes also take a deeper back-edge (2+ layers up).
            if l >= 2 && rng.below(4) == 0 {
                let bl = rng.below(l - 1);
                let bw = rng.below(width);
                edges.push(SchedEdge { from: id(bl, bw), to: id(l, w) });
            }
        }
    }
    (nodes, edges)
}

/// A Jira-ladder tree of the same rough size: project → epics → stories → tasks.
fn ladder_tree(epics: usize, stories_per: usize, tasks_per: usize) -> (Vec<LadderNode>, Vec<ParentEdge>) {
    let mut nodes = vec![LadderNode { id: "P".into(), kind: "project".into() }];
    let mut parents = Vec::new();
    for e in 0..epics {
        let eid = format!("E{e:02}");
        nodes.push(LadderNode { id: eid.clone(), kind: "epic".into() });
        parents.push(ParentEdge { parent: "P".into(), child: eid.clone() });
        for s in 0..stories_per {
            let sid = format!("S{e:02}-{s:02}");
            nodes.push(LadderNode { id: sid.clone(), kind: "story".into() });
            parents.push(ParentEdge { parent: eid.clone(), child: sid.clone() });
            for t in 0..tasks_per {
                let tid = format!("T{e:02}-{s:02}-{t:02}");
                nodes.push(LadderNode { id: tid.clone(), kind: "task".into() });
                parents.push(ParentEdge { parent: sid.clone(), child: tid.clone() });
            }
        }
    }
    (nodes, parents)
}

fn bench_schedule(c: &mut Criterion) {
    let mut group = c.benchmark_group("schedule");
    // (layers, width) → node count: 10x6=60, 12x10=120, 15x13≈195.
    for &(layers, width) in &[(10usize, 6usize), (12, 10), (15, 13)] {
        let (nodes, edges) = layered_dag(layers, width);
        let n = nodes.len();
        // Sanity: the generated DAG must actually schedule (acyclic, resolvable).
        assert!(schedule(&nodes, &edges).ok, "generated DAG must be schedulable");
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &(nodes, edges), |b, (nodes, edges)| {
            b.iter(|| schedule(black_box(nodes), black_box(edges)));
        });
    }
    group.finish();
}

fn bench_ladder(c: &mut Criterion) {
    let mut group = c.benchmark_group("validate_ladder");
    let (nodes, parents) = ladder_tree(8, 5, 3); // 1 + 8 + 40 + 120 = 169 nodes
    assert!(validate_ladder(&nodes, &parents).ok);
    group.throughput(Throughput::Elements(nodes.len() as u64));
    group.bench_function("tree_169", |b| {
        b.iter(|| validate_ladder(black_box(&nodes), black_box(&parents)));
    });
    group.finish();
}

criterion_group!(benches, bench_schedule, bench_ladder);
criterion_main!(benches);
