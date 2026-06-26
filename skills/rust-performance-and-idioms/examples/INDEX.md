# examples/ — Index

Runnable, measured artifacts for `rust-performance-and-idioms`. These are real
crates you can `cargo test` / `cargo bench`, not snippets.

| Example | What it demonstrates |
|---------|----------------------|
| [`wordcount/`](wordcount/README.md) | The worked before/after: two word counters returning identical output, where deleting per-word allocation took the hot path from 1.84 ms to 0.99 ms (1.86×) on a 50k-token corpus. Shows the full method — equality test, criterion A/B in one group, confidence intervals — not just the result. |

## Running

```bash
cd wordcount
cargo test --release          # proves both implementations agree (required)
cargo bench --bench wordcount # reproduces the measured table in wordcount/README.md
```

> Numbers move with CPU, allocator, and corpus. Reproduce before trusting any
> table — the transferable part is the *method*, not the absolute milliseconds.
