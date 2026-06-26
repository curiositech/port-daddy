# Changelog — rust-debugging-mastery

## [0.1.0] — 2026-06-26

Initial release.

- `SKILL.md` index: thesis (match the tool to the bug's shape), a symptom→tool decision-point
  Mermaid flowchart, a Core Capabilities table, six Novice-vs-Expert failure modes, a quality-gate
  checklist, and a worked-example index.
- `references/01-tracing-and-async.md`: `tracing`/`tracing-subscriber`, `#[instrument]`,
  EnvFilter/`RUST_LOG` grammar, JSON logs, the span-guard-across-`.await` trap, `tokio-console`
  (setup, `tokio_unstable`, the built-in warnings), stuck/cancelled futures, the two-executor footgun.
- `references/02-native-ffi-and-dyld.md`: macOS dyld load failures, `@rpath`/`@loader_path`,
  `DYLD_*` + SIP stripping, `otool`/`install_name_tool`/`nm`/`c++filt`, codesign-after-edit,
  `dlerror`/`libloading`, detect-and-disable, FFI panic boundaries.
- `references/03-profiling-and-memory.md`: `cargo flamegraph`, `samply`, `cargo-instruments`/`xctrace`,
  reading a flamegraph, Miri (catches/misses, `MIRIFLAGS`).
- `references/04-panics-and-heisenbugs.md`: `RUST_BACKTRACE`, unwind vs abort, `catch_unwind`,
  panic hooks, `RUST_MIN_STACK` vs `#![recursion_limit]`, heisenbugs, ThreadSanitizer/AddressSanitizer.
- `references/05-lldb-and-build-link.md`: `rust-lldb`/`rust-gdb`, pretty-printers, regex breakpoints
  for monomorphized generics, why async backtraces lie, split-debuginfo, `cargo build -v`,
  `cargo tree -d`/`-i`, linker-error triage.
- `examples/dyld-segfault-onnxruntime.md` and `examples/async-stall-tokio-console.md`: two debug-session
  transcripts.
- Grounded in current (June 2026) crate versions and Apple man pages / real GitHub issues; URLs cited
  in each reference. Accuracy notes encoded: `DYLD_FALLBACK_LIBRARY_PATH` has no default for Fall-2023+
  binaries; FFI panic-unwind is a defined abort since Rust 1.81 (UB before).
