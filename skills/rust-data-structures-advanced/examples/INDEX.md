# Examples — rust-data-structures-advanced

Runnable, compilable demonstrations of the skill's core moves. Both build green under
[Cargo.toml](Cargo.toml) (versions pinned by `Cargo.lock`):

```bash
cargo build                       # builds both bins
cargo run --bin slotmap_graph
cargo run --bin crossbeam_pipeline
```

| File | Walks through |
|------|---------------|
| [slotmap_graph.rs](slotmap_graph.rs) | A mutable, cyclic, deletable graph with `slotmap` + a `SecondaryMap` — the no-`Rc<RefCell>` pattern, with DFS traversal and generation-checked stale-key detection on delete |
| [crossbeam_pipeline.rs](crossbeam_pipeline.rs) | A bounded multi-stage `crossbeam-channel` (MPMC) pipeline with scoped threads, backpressure, and clean channel-drop shutdown |
| [Cargo.toml](Cargo.toml) | Pins the exact crate versions both bins compile against (`slotmap`, `crossbeam-channel`) |
