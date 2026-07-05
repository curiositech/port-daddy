# References

Load only the file that matches the bug in front of you.

- `01-tracing-and-async.md`: `tracing` / `tracing-subscriber` setup, `#[instrument]`,
  EnvFilter/`RUST_LOG` grammar, JSON logs, the span-guard-across-`.await` trap, `tokio-console`
  (setup + the `never-yielded`/`lost-waker`/`self-wakes` warnings), stuck/cancelled futures, and
  the two-executor (tokio↔smol) footgun.
- `02-native-ffi-and-dyld.md`: macOS dyld load failures (`Library not loaded` / `image not
  found`), `@rpath`/`@loader_path`/`@executable_path`, `DYLD_PRINT_*` + SIP stripping,
  `otool -L`/`-l`, `install_name_tool` + the mandatory `codesign` re-sign, `nm`/`c++filt` symbol
  diffs, `dlerror`/`libloading`, detect-and-disable, and Rust panics across the FFI boundary.
- `03-profiling-and-memory.md`: `cargo flamegraph`, `samply`, `cargo-instruments`/`xctrace`,
  reading a flamegraph, and Miri (what it catches, what it misses, `MIRIFLAGS`).
- `04-panics-and-heisenbugs.md`: `RUST_BACKTRACE`, unwind vs abort, `catch_unwind`, custom panic
  hooks, `RUST_MIN_STACK` (runtime) vs `#![recursion_limit]` (compile-time), heisenbugs, and
  ThreadSanitizer/AddressSanitizer.
- `05-lldb-and-build-link.md`: `rust-lldb`/`rust-gdb`, pretty-printers, regex breakpoints for
  monomorphized generics, why async backtraces lie, split-debuginfo, `cargo build -v`,
  `cargo tree -d`/`-i`, and linker-error triage.
