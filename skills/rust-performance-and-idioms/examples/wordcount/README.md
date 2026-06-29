# Worked example: allocation discipline, measured

A runnable before/after for the `rust-performance-and-idioms` skill. Two word
counters that return **identical** output; only allocation behavior differs.
The point is the *method* — change one variable, measure with Criterion, keep
the change only if the confidence interval says it helped.

```bash
cargo test --release          # prove both versions agree (they must)
cargo bench --bench wordcount # measure the gap
```

## What changed

| | `word_counts_naive` | `word_counts_disciplined` |
|---|---|---|
| Lowercase corpus | once (`to_lowercase`) | once (`to_lowercase`) — *unchanged, so it's not the variable* |
| Tokenization | `.collect::<Vec<String>>()` — a `String` per word + a 50k `Vec` | lazy `split_whitespace()`, no intermediate `Vec` |
| Map key | owned `String` for **every** token | `&str` borrowed-probe; allocates only on a word's **first** sighting |

The corpus is 50,000 tokens drawn from a 20-word lexicon. So the naive version
heap-allocates ~50,000 short `String`s; the disciplined one allocates ~20.

## Measured result

`rustc 1.94.0`, Apple silicon, `opt-level = 3`, `lto = "thin"`,
`codegen-units = 1` (the `[profile.bench]` in `Cargo.toml`), Criterion
`--measurement-time 5 --warm-up-time 2`:

| Benchmark | Median time | Throughput | Speedup |
|-----------|-------------|------------|---------|
| `naive` | **1.844 ms** | 176 MiB/s | 1.0× (baseline) |
| `disciplined` | **0.993 ms** | 328 MiB/s | **1.86×** (−46% wall time) |

Criterion's CIs are tight (`[1.838, 1.852] ms` vs `[0.991, 0.994] ms`,
p < 0.05), so the win is real, not noise. Eliminating ~50k transient
allocations nearly doubled throughput with zero change to the result or to
readability — the canonical "free" win.

## The lesson, and the limit

- **The smell:** `.to_string()` / `.collect::<Vec<_>>()` inside a hot loop.
- **The fix:** borrow (`&str`), iterate lazily, allocate only what you keep.
- **When NOT to bother:** if this ran once at startup over 200 bytes, the 0.85 ms
  you saved is invisible and the borrowed-probe (`get_mut` then `insert`) is
  marginally more code. Profile first; this function earned the change because
  it's hot and the corpus is large. See `references/01-profiling-and-benching.md`.

> Reproduce it yourself before trusting the table. Numbers move with CPU,
> allocator, and corpus. The *method* is the transferable part.
