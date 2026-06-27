# 01 — Profiling & Benchmarking: measure before you touch anything

> Source of truth: The Rust Performance Book,
> <https://nnethercote.github.io/perf-book/profiling.html> and
> <https://nnethercote.github.io/perf-book/benchmarking.html>.

The rule that governs this whole skill: **you may not optimize code you have not
profiled.** Intuition about where Rust spends time is wrong often enough that
acting on it wastes effort and uglifies code. Get a profile, find the widest
bars, change those, re-measure.

## The workflow

```
1. Reproduce a representative workload (a bench or a realistic input).
2. Profile it → find WHERE the time/allocations go (samply, flamegraph, DHAT).
3. Form ONE hypothesis about the widest bar.
4. Change ONE thing.
5. Re-measure with criterion → keep only if the CI says it improved.
6. Repeat on the next widest bar, or stop when "fast enough".
```

Steps 1 and 5 are the ones people skip. Don't.

## Picking a profiler

| Tool | What it's best at | Invoke |
|------|-------------------|--------|
| **samply** | CPU sampling, cross-platform (mac/Linux/Win), opens in Firefox Profiler — the easy default | `cargo install samply; samply record ./target/release/app` |
| **cargo-flamegraph** | One-command flamegraph via `perf`/DTrace; great first look | `cargo install flamegraph; cargo flamegraph --bench mybench` |
| **perf** (Linux) | Lowest-overhead sampling, hardware counters (cache misses, branch misses) | `perf record -g ./app; perf report` |
| **Instruments** (macOS) | Time Profiler + Allocations + System Trace; best allocation view on mac | `xcrun xctrace record --template "Time Profiler" --launch ./app` |
| **DHAT / dhat-rs** | *Allocation* profiling: counts, sizes, lifetimes — the right tool when malloc is wide | `dhat::Profiler` feature, or `valgrind --tool=dhat` |
| **`cargo-instruments`** | Ergonomic wrapper to open Instruments templates from cargo | `cargo install cargo-instruments; cargo instruments -t alloc` |

Build with debug symbols so the profile is readable, even in release:

```toml
[profile.release]
debug = 1          # line tables; no effect on codegen, big effect on flamegraph legibility
```

Then `cargo build --release` and profile the release binary — **never profile a
debug build**, its performance has no relationship to what ships.

## Reading a flamegraph (the 30-second version)

- **Width = time** (samples), not call order. Wide bars are where you live.
- Look for surprises near the bottom-wide region: `__rust_alloc` / `free` /
  `memcpy` / `drop_in_place` mean allocation pressure → reference 02.
  `__psynch_mutexwait` / futex means lock contention → reference 04.
- A deep narrow tower is fine; a wide plateau is the target.
- "Self time" (the tip of the flame, not its descendants) tells you the leaf
  function actually burning cycles.

## Benchmarking with Criterion (the credible number)

Criterion handles warmup, takes many samples, reports a confidence interval, and
flags regressions against the previous run. A single `Instant::now()` delta is
not a benchmark — it's one noisy sample.

```rust
// Cargo.toml
// [dev-dependencies]
// criterion = { version = "0.5", features = ["html_reports"] }
// [[bench]]
// name = "mybench"
// harness = false

use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench(c: &mut Criterion) {
    let input = make_realistic_input();
    c.bench_function("hot_fn", |b| {
        b.iter(|| hot_fn(black_box(&input)))   // black_box stops the optimizer
    });                                        // from deleting the work entirely
}
criterion_group!(benches, bench);
criterion_main!(benches);
```

```bash
cargo bench                         # full run, writes target/criterion/*/report
cargo bench --bench mybench -- --measurement-time 5 --warm-up-time 2   # faster iteration
```

### `black_box` is not optional

Without `black_box`, LLVM can prove your benchmark's output is unused and delete
the computation — you'll "measure" a function that compiles to nothing and
celebrate a fake 1000× win. Wrap both the input (so it isn't const-folded) and,
when in doubt, the output.

### Comparing A vs B honestly

Put both versions in one `benchmark_group` over the *same* input (see
`examples/wordcount/benches/wordcount.rs`). Change one variable at a time. Trust
the win only when the CIs don't overlap and Criterion reports `p < 0.05`. If the
intervals overlap, you measured noise — the change is neither better nor worse,
so prefer the more readable version.

## Nightly `#[bench]` and `cargo-criterion`

`#[bench]` + `test::Bencher` exists but needs nightly and is less capable than
Criterion; prefer Criterion on stable. `cargo-criterion` is a separate front-end
that adds machine-readable output and better CI integration.

## Pitfalls

- **Benchmarking a debug build.** Numbers are meaningless. Always `--release`.
- **Tiny unrepresentative inputs.** A 50-byte input won't reveal allocation or
  cache behavior. Size the workload like production.
- **One-shot timing.** Cold caches, CPU frequency scaling, and OS noise swamp a
  single run. Let Criterion sample.
- **Optimizing the wrong layer.** If 80% of time is in I/O or the network, a 2×
  CPU win is a 0.4% total win. The flamegraph tells you the layer.
- **Forgetting to re-profile after the fix.** The bottleneck moves. The second
  widest bar is now the widest.

## Sources

- The Rust Performance Book — Profiling & Benchmarking:
  <https://nnethercote.github.io/perf-book/profiling.html>,
  <https://nnethercote.github.io/perf-book/benchmarking.html>
- samply: <https://github.com/mstange/samply>
- cargo-flamegraph: <https://github.com/flamegraph-rs/flamegraph>
- Criterion.rs: <https://bheisler.github.io/criterion.rs/book/>
- dhat-rs: <https://docs.rs/dhat/>
