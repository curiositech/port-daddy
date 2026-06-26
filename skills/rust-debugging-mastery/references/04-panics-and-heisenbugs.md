# Panics, backtraces, and heisenbugs

---

## 1. Backtraces

Default panic output (verbatim, from The Book):

```
thread 'main' panicked at src/main.rs:4:6:
index out of bounds: the len is 3 but the index is 99
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

```bash
RUST_BACKTRACE=1 ./myprog        # abbreviated: your frames + key runtime frames
RUST_BACKTRACE=full ./myprog     # every frame, incl. panic runtime / libstd / lang-start glue
RUST_BACKTRACE=0 ./myprog        # disabled
```

`full` adds the frames `=1` trims for readability. **Requires debug symbols** — on by default in
debug builds, off in release unless `[profile.release] debug = true`. A backtrace of unnamed
`<unknown>` frames means you profiled/ran a stripped release build — rebuild with `debug = true`.
(`RUST_LIB_BACKTRACE` separately controls `std::backtrace::Backtrace::capture()`.)

---

## 2. Unwind vs abort

```toml
[profile.release]
panic = "abort"     # smaller binary, no unwind tables; a panic = immediate process termination
```

`-C panic` values: `unwind` (default on most targets), `abort`, and `immediate-abort` (terminate
*and skip panic hooks*). Implications:

- Under `panic = "abort"`, **`catch_unwind` catches nothing** — the process dies; destructors
  during unwinding don't run.
- **FFI / `cdylib`**: unwinding *across* an FFI boundary is abort-since-1.81 (UB before). For a
  `cdylib`/staticlib exposed to C, prefer `panic = "abort"`, or wrap every `extern "C"` body in
  `catch_unwind` (see `02-native-ffi-and-dyld.md` §5).
- **Tests, benches, build scripts, proc-macros ignore the `panic` setting** — the test harness
  requires `unwind`. So you cannot test panic behavior of an `abort` binary via the normal harness.

---

## 3. `catch_unwind` and custom panic hooks

```rust
// Recoverable panic boundary (NOT a general try/catch — prefer Result for routine errors):
let r = std::panic::catch_unwind(|| { risky() });   // Ok(v) | Err(payload)
// Closure must be UnwindSafe; wrap with AssertUnwindSafe to assert manually.
```

```rust
// Crash reporting / structured logging: a hook runs on panic BEFORE the panic runtime,
// under BOTH unwind and abort runtimes (so it fires even with panic = "abort", unlike catch_unwind).
let prev = std::panic::take_hook();
std::panic::set_hook(Box::new(move |info| {
    tracing::error!(panic = %info, "thread panicked");   // info: &PanicHookInfo (payload + location)
    prev(info);                                          // delegate to the default (prints + backtrace)
}));
```

`set_hook` is global and **panics if called from a panicking thread**. `catch_unwind` does **not**
suppress the hook — the hook runs, *then* `catch_unwind` returns `Err`. Common pattern:
`take_hook()` → wrap to log → `set_hook()`.

---

## 4. Stack size vs recursion limit — the perennial confusion

| Knob | When | Controls |
|---|---|---|
| **`RUST_MIN_STACK`** | **Runtime** env var | Minimum thread stack size. Spawned threads default ~**2 MiB**, main ~**8 MiB**. Raise for deep *runtime* recursion: `RUST_MIN_STACK=16777216 ./myprog`. Or `thread::Builder::new().stack_size(N)`. |
| **`#![recursion_limit = "N"]`** | **Compile-time** crate attribute | Macro-expansion and type/trait recursion depth (default 128). **Nothing** to do with the runtime call stack. |

A real **runtime** stack overflow is **not a panic** — the guard page traps it and the runtime
aborts:

```
thread 'main' has overflowed its stack
fatal runtime error: stack overflow
```

…then SIGABRT. It is **not catchable** by `catch_unwind`. Fix with `RUST_MIN_STACK` / a bigger
`stack_size`, or convert recursion to iteration / a heap work-queue. If instead the failure is at
`cargo build` ("recursion limit reached while expanding / instantiating"), that is the
**compile-time** limit — raise `recursion_limit`; `RUST_MIN_STACK` does nothing for it.

---

## 5. Heisenbugs — release vs debug, optimization-dependent UB

Why behavior differs between profiles:

- **Integer overflow**: `overflow-checks` defaults **on in dev** (panics: *"attempt to add with
  overflow"*) and **off in release** (two's-complement wrap). A bug that panics in `cargo run`
  silently wraps in `--release`. Reproduce: `[profile.release] overflow-checks = true` (or
  `-C overflow-checks=on`).
- **UB only under optimization**: dangling pointers, aliasing violations, uninitialized reads,
  and data races may "work" unoptimized and break once LLVM applies the assumptions the UB
  violates. The bug was always there; `-O` exposed it.
- **Data races**: surface only at particular interleavings / under contention / load.

**Why adding a `println!` "fixes" it**: I/O + formatting change timing, take a lock on stdout, and
shift register/stack layout — perturbing the race window or the optimizer's assumptions so the
symptom hides. Bug vanishes when observed = the heisenbug signature. **Do not "fix" by adding a
log.** Reproduce deterministically:

```bash
# Data races (verbatim TSan output form: "WARNING: ThreadSanitizer: data race"):
RUSTFLAGS="-Zsanitizer=thread" RUSTDOCFLAGS="-Zsanitizer=thread" \
  cargo +nightly run -Zbuild-std --target aarch64-apple-darwin

# OOB / use-after-free / leaks:
RUSTFLAGS="-Zsanitizer=address" RUSTDOCFLAGS="-Zsanitizer=address" \
  cargo +nightly run -Zbuild-std --target aarch64-apple-darwin

# Uninitialized reads: -Zsanitizer=memory ; leaks-only: -Zsanitizer=leak
```

**Sanitizer rules (critical):** nightly only; **always pass `--target <triple>`** so the flags do
not leak into build scripts / proc-macros; rebuild std with `-Zbuild-std` for accurate results.
TSan/ASan support `x86_64-unknown-linux-gnu`, `x86_64-apple-darwin`, `aarch64-apple-darwin`,
`aarch64-unknown-linux-gnu`; MSan/LSan are Linux-leaning. Pair with **Miri** (`03-…`) for the UB
classes sanitizers miss, and bisect with `git bisect` if it appeared between releases.

---

## Sources

- [The Rust Book Ch.9.1 — panic & RUST_BACKTRACE](https://doc.rust-lang.org/book/ch09-01-unrecoverable-errors-with-panic.html)
- [std::panic::catch_unwind](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) · [set_hook / take_hook](https://doc.rust-lang.org/std/panic/fn.set_hook.html) · [std::backtrace](https://doc.rust-lang.org/std/backtrace/index.html)
- [rustc codegen options — debuginfo, panic, overflow-checks](https://doc.rust-lang.org/rustc/codegen-options/index.html) · [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html)
- [rustc unstable book — sanitizers (-Zsanitizer, -Zbuild-std)](https://doc.rust-lang.org/unstable-book/compiler-flags/sanitizer.html)
