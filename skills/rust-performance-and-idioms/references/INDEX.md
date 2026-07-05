# references/ — Index

Deep-dive material for `rust-performance-and-idioms`, loaded on demand. Each file
maps to a branch of the decision tree in `SKILL.md`.

| File | When to load |
|------|--------------|
| `01-profiling-and-benching.md` | You need to find *where* time/allocations go (samply, cargo-flamegraph, perf, Instruments, DHAT) or write a credible criterion benchmark before changing anything |
| `02-allocation-and-layout.md` | The profile shows allocation/copy pressure, or you're choosing `&str`/`Cow`/`SmallVec`/`with_capacity`/arena, iterator-vs-loop, SoA, field ordering, or fixing false sharing |
| `03-simd-and-codegen.md` | You have a hot numeric loop (autovectorization, portable-simd, `target-feature`), are choosing `Box<dyn>` vs generics / `#[inline]`, or tuning binary size & compile time (LTO, codegen-units, opt-level, strip, cargo-bloat) |
| `04-async-and-contention.md` | The async executor is starved (blocking IO/compute, `spawn_blocking` vs rayon, buffering, two-runtime cost) or threads are fighting an `Arc<Mutex>` (channels, sharding, atomics) |
| `05-idioms-cheatsheet.md` | You want idiomatic *and* fast: newtype, `impl Trait` returns, `let-else`, `matches!`, exhaustive match, `?`-friendly errors, builders, or `unsafe` done right with `// SAFETY:` + Miri |
