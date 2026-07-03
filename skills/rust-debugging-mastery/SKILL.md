---
license: Apache-2.0
name: rust-debugging-mastery
description: |
  Expert-level Rust debugging beyond `println!` and `dbg!`. Covers rust-lldb/rust-gdb
  (pretty-printers, breakpoints on monomorphized generics, why async backtraces lie),
  `tracing`/`tracing-subscriber` (spans, EnvFilter/RUST_LOG, the span-guard-across-.await
  trap), tokio-console for async stalls/deadlocks, Miri for UB and data races,
  cargo-flamegraph/samply/Instruments for hot paths, panics & backtraces (RUST_BACKTRACE,
  panic hooks, catch_unwind, abort vs unwind), debugging stuck/cancelled futures and the
  two-executor footgun, FFI/native-addon/dyld failures (@rpath/DYLD_*/install_name_tool,
  a .node/cdylib that segfaults its host), build/link debugging (cargo build -v, cargo tree
  -d, RUST_MIN_STACK vs recursion_limit), and heisenbugs (release-vs-debug, optimization UB).
  Activate on: "debug rust", "rust panic", "segfault", "stack overflow", "RUST_BACKTRACE",
  "rust-lldb", "rust-gdb", "tokio-console", "tracing subscriber", "RUST_LOG", "miri",
  "data race", "flamegraph", "samply", "@rpath", "Library not loaded", "dlopen", "image not found",
  "install_name_tool", "DYLD", "dylib", ".node crashes", "async deadlock", "stuck future",
  "undefined behavior", "heisenbug", "linker error", "duplicate dependency".
  NOT for: writing new Rust features from scratch (use a code-gen skill), generic borrow-checker
  teaching, GPUI/pd-console rendering bugs (use gpui-rust-console), macOS app notarization/packaging
  (use rust-app-distribution), or non-Rust native debugging.
allowed-tools: Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch
metadata:
  category: Debugging & Diagnostics
  tags:
    - rust
    - debugging
    - lldb
    - tracing
    - tokio-console
    - miri
    - flamegraph
    - dyld
    - ffi
    - async
    - panic
    - heisenbug
  pairs-with:
    - skill: daemon-development
      reason: Long-running Rust daemons are where async stalls, FFI crashes, and panic-abort policy bite hardest
    - skill: gpui-rust-console
      reason: GPUI/pd-console rendering, layout, and the two-executor (reqwest/smol) pipeline live there; this skill covers the generic debugging underneath
    - skill: git-best-practices
      reason: Bisecting a heisenbug across commits needs disciplined git workflow
    - skill: rust-with-claude-code
      reason: Shares the toolchain/testing workflow this skill's diagnosis techniques plug into when pairing with an agent
    - skill: rust-app-distribution
      reason: A dyld/codesign failure diagnosed here often traces back to a notarization or install_name_tool step in the distribution pipeline
  provenance:
    kind: first-party
    owners: [port-daddy]
  authorship:
    maintainers: [port-daddy]
  io-contract:
    kind: deliverable
    consumes:
      - kind: bug-report
        format: markdown
        description: A symptom description -- panic message, hang, slow path, wrong result, dyld/link failure, UB suspicion, or heisenbug -- as reported by a human or another agent.
      - kind: debug-session-plan
        format: json
        description: A structured plan naming the chosen tool(s), async-ness of the code path, and the specific knobs/flags intended for the session.
    produces:
      - kind: diagnosis
        format: markdown
        description: The root-cause diagnosis and tool-selection rationale, following the Decision Points flowchart and matched to the bug's shape.
      - kind: debug-readiness-audit
        format: json
        description: A deterministic pass/fail audit of the debug-session-plan against this skill's Quality Gates, as produced by scripts/debug_plan_audit.mjs.
category: Debugging & Diagnostics
---

# Rust Debugging Mastery

The skill for the Rust bugs that `println!` cannot reach: a future that never wakes, a
`.node` addon that takes the whole daemon down with it, UB that only appears under `--release`,
a generic function whose breakpoint never fires because it is actually six functions.

**Thesis: match the tool to the bug's *shape*, not your habit.** Every Rust debugging tool
answers one question. A traditional debugger (`rust-lldb`) answers *"what is the state at this
line?"* — and is nearly useless for async, because a suspended task is heap state, not a stack
frame. `tracing` answers *"what happened, in what causal order?"*. `tokio-console` answers
*"which task is stuck or starving the executor?"*. Miri answers *"is this UB?"*. A flamegraph
answers *"where is the time going?"*. `dyld`/`otool` answer *"why won't this library load?"*.
Reaching for the wrong one is the single biggest time sink — see the Decision Points below
before you `b main.rs:1`.

## NOT for

- Writing new Rust features or teaching the borrow checker — this is a *diagnosis* skill.
- GPUI / `pd-console` rendering, layout, focus, or the reqwest↔smol refresh pipeline → `gpui-rust-console`.
- macOS app packaging, notarization, stapling → `rust-app-distribution`.
- Non-Rust native debugging where Rust-specific pretty-printers and Miri do not apply.

## Decision Points — pick the tool by the bug's shape

```mermaid
flowchart TD
  A[Rust bug] --> B{What is the symptom?}
  B -->|Panic / crash with a message| C{Crash kind}
  C -->|"panicked at ..."| C1[RUST_BACKTRACE=full + panic hook → 04-panics-and-heisenbugs.md]
  C -->|"has overflowed its stack"| C2[RUST_MIN_STACK, NOT recursion_limit → 04]
  C -->|"SIGSEGV / SIGABRT, no Rust message"| C3[FFI/native lib or UB → 02-native-ffi-and-dyld.md / Miri]
  B -->|"Library not loaded / image not found / dlopen"| D[dyld: otool -L, DYLD_PRINT_*, install_name_tool → 02]
  B -->|Hangs / deadlocks / stalls, no crash| E{Async?}
  E -->|Yes| E1[tokio-console: never-yielded / lost-waker → 01-tracing-and-async.md]
  E -->|No| E2[rust-lldb: bt all on each thread for the lock cycle → 05-lldb-and-build-link.md]
  B -->|Wrong result, want causal trace| F[tracing spans + EnvFilter → 01]
  B -->|Too slow| G[flamegraph / samply / Instruments → 03-profiling-and-memory.md]
  B -->|"Works in debug, breaks in release" or flaky| H[Heisenbug: Miri + sanitizers, overflow-checks → 04]
  B -->|Suspected UB / unsafe / data race| I[Miri + ThreadSanitizer → 03 / 04]
  B -->|"undefined symbol" / "multiple definition" / won't link| J[cargo build -v, cargo tree -d → 05]
  B -->|Need to step through state at a line| K[rust-lldb, regex breakpoints for generics → 05]
```

The first branch is the one people get wrong: a **hang is not a debugger problem**. Attaching
`lldb` to a deadlocked async program shows you executor poll frames, not which task is waiting on
what. Go to `tokio-console` first.

## Core Capabilities

| Capability | Tool / mechanism | The one gotcha | Depth |
|---|---|---|---|
| Source-level stepping, state inspection | `rust-lldb` / `rust-gdb` (Rust pretty-printers) | Breakpoint on a generic fn misses monomorphizations — use a **regex** breakpoint | `05-lldb-and-build-link.md` |
| Causal, structured logs | `tracing` + `tracing-subscriber` `EnvFilter` | **Never hold `span.enter()`'s guard across `.await`** — use `#[instrument]` or `.instrument()` | `01-tracing-and-async.md` |
| Async stalls, deadlocks, leaked tasks | `tokio-console` + `console-subscriber` | Needs `RUSTFLAGS="--cfg tokio_unstable"` + `tokio` `tracing` feature, else no data | `01-tracing-and-async.md` |
| UB, use-after-free, data races, aliasing | Miri (`cargo +nightly miri test`) | It is an *interpreter* — only checks paths you actually run; no real FFI | `03-profiling-and-memory.md` |
| Data races / OOB / leaks at native speed | ThreadSanitizer / AddressSanitizer (`-Zsanitizer`) | Nightly + **always pass `--target`** so flags don't leak into build scripts | `04-panics-and-heisenbugs.md` |
| Hot-path / CPU profiling | `cargo flamegraph`, `samply`, Instruments | Width = time; needs `[profile.release] debug = true` for symbols | `03-profiling-and-memory.md` |
| Panic diagnosis & policy | `RUST_BACKTRACE`, `set_hook`, `catch_unwind`, `panic="abort"` | `catch_unwind` cannot catch under `panic="abort"`; hooks still fire | `04-panics-and-heisenbugs.md` |
| Stuck / cancelled futures, two-executor bug | `tokio-console`, `tracing`, cancellation audit | reqwest(tokio)↔GPUI(smol) cannot share an executor — channel between them | `01-tracing-and-async.md` |
| **FFI / native-addon / dyld crashes** | `otool -L/-l`, `DYLD_PRINT_*`, `install_name_tool`, `nm`+`c++filt`, `dlerror` | A hard dyld load failure **aborts the host process** — you cannot catch it after the fact; probe before loading | `02-native-ffi-and-dyld.md` |
| Build / link failures, dup deps | `cargo build -v`, `cargo tree -d`/`-i`, `RUSTFLAGS` | `RUST_MIN_STACK` (runtime) ≠ `#![recursion_limit]` (compile-time) | `05-lldb-and-build-link.md` |

## Failure Modes — Novice vs Expert

### Holding a `tracing` span guard across `.await`
**Novice**: `let _g = span.enter(); some_future.await;` — looks like normal RAII scoping.
**Expert**: When the task yields at `.await`, the scope is *exited* but the guard is **not dropped**,
so another task runs while still "inside" your span — the trace is corrupted. Use
`#[tracing::instrument]` on the async fn, or `future.instrument(span).await` (the `Instrument`
trait re-enters on each poll and exits on each yield). The docs say it verbatim: *"Holding the
drop guard returned by `Span::enter` across `.await` points will result in incorrect traces."*
**Detection**: any `.enter()`/`.entered()` whose guard lives in a scope containing an `.await`.

### Attaching a debugger to a hung async program
**Novice**: program deadlocks → `rust-lldb -p <pid>` → `bt` → sees `tokio::runtime::...::poll` and
gives up.
**Expert**: A suspended `.await` is heap state, not a stack frame; the executor only ever calls
`poll` on the *outer* future, so the physical stack never shows "task A awaits lock held by task B."
Reach for **`tokio-console`** (`lost-waker` = a task dropped without being woken = will never
complete; `never-yielded` = a task blocking the worker thread) or annotate with
`#[async_backtrace::framed]` to dump the *logical* task tree including suspended tasks.
**Detection**: a hang with no CPU usage (deadlock) or one core pinned at 100% (a `.await`-free hot
loop / blocking syscall starving the executor).

### Breakpoint on a generic function that never fires
**Novice**: `b my_crate::process` on `fn process<T>(..)` — fires for `process::<u32>` but not
`process::<String>`, or not at all.
**Expert**: Monomorphization emits a *separate* symbol per instantiating type. Catch them all with
a regex breakpoint: LLDB `breakpoint set -r 'my_crate::process'`, GDB `rbreak my_crate::process`.
**Detection**: a breakpoint that "works sometimes" depending on which type path the test exercises.

### `RUST_MIN_STACK` for a stack-overflow that is actually a compile error
**Novice**: deep macro/type recursion fails to compile → "increase the stack" → `RUST_MIN_STACK=...`.
**Expert**: `RUST_MIN_STACK` resizes a **runtime** thread stack and does nothing for a *compile-time*
recursion limit — that needs `#![recursion_limit = "256"]`. Conversely a **runtime** "thread '...'
has overflowed its stack / fatal runtime error: stack overflow" is *not* a panic, is **not**
catchable by `catch_unwind`, and is fixed by `RUST_MIN_STACK` or a bigger `thread::Builder::stack_size`
(or converting recursion to iteration). These two knobs are constantly confused.
**Detection**: error at `cargo build` (compile) vs at run time decides which knob.

### Letting a native library failure crash the whole daemon
**Novice**: `let lib = Library::new("libonnxruntime.dylib").unwrap();` at startup — a missing/unsigned
dylib takes the entire process down with `dyld: Library not loaded: @rpath/...  Reason: image not found`.
**Expert**: A *hard* dyld abort cannot be caught after the fact. Either (a) bundle the dylib next to
the addon and rewrite its install name to `@loader_path/libonnxruntime.dylib` (immune to SIP-stripped
`DYLD_*`), then re-sign (`install_name_tool` invalidates the signature; arm64 SIGKILLs unsigned code),
or (b) **detect-and-disable**: probe with `dlopen(..., RTLD_NOLOAD)` / `libloading::Library::new(..)`
and on `Err` degrade the *feature*, never the *process*.
**Detection**: any `unwrap()`/`expect()` on a `Library::new` / `dlopen` at a process-critical path.

### Trusting `--release` to behave like `cargo run`
**Novice**: tests pass in debug, ships release, gets silent wrong answers or a crash under load.
**Expert**: `overflow-checks` defaults **on** in dev (panics) and **off** in release (wraps); UB
(aliasing, uninitialized reads, data races) can be benign unoptimized and fatal once LLVM applies
its assumptions. Adding a `println!` "fixes" it because I/O perturbs timing/layout — the classic
heisenbug tell. Reproduce deterministically with Miri + ThreadSanitizer and
`[profile.release] overflow-checks = true`, not by adding logs.
**Detection**: behavior that changes between profiles, or vanishes when observed.

## Quality Gates

```
□ Tool matched to bug shape (hang→tokio-console, UB→Miri, slow→flamegraph) — not "lldb for everything"
□ No tracing span guard (.enter()/.entered()) held across an .await in async code
□ tokio-console build has RUSTFLAGS="--cfg tokio_unstable" + tokio "tracing" feature
□ Release profiling/debug has [profile.release] debug = true (symbols), else flat unnamed frames
□ Generic-fn breakpoints use a regex (lldb -r / gdb rbreak), not a bare symbol
□ Stack-overflow fix uses the right knob: RUST_MIN_STACK (runtime) vs recursion_limit (compile-time)
□ Every dlopen/Library::new on a critical path is probed/guarded — missing native lib degrades, never aborts
□ After install_name_tool on macOS: re-signed (codesign --force --sign -); arm64 will SIGKILL unsigned code
□ Heisenbug reproduced under Miri / sanitizer / overflow-checks — NOT "fixed" by adding a print
□ FFI panic boundary handled: catch_unwind shim on extern "C", OR panic="abort" chosen deliberately
□ Backtrace claims verified with RUST_BACKTRACE=full on a debug or debug=true build
```

## Deterministic Debug-Plan Audit

Before committing to a debugging session (or reviewing another agent's), run
`scripts/debug_plan_audit.mjs` against a `debug-session-plan` matching
`schemas/debug-plan.schema.json`. It encodes this skill's thesis — match the tool to the
bug's *shape* — and its Quality Gates as a deterministic check, catching the exact
mismatches called out above (lldb for an async hang, `RUST_MIN_STACK` for a compile-time
recursion limit, tokio-console with no unstable flags, an unguarded `dlopen`, a heisenbug
"fixed" by a print instead of reproduced under Miri).

```bash
node scripts/debug_plan_audit.mjs --input examples/sample-input.json
```

`examples/sample-input.json` is a `hang`+async plan correctly routed to tokio-console
(`pass: true`). `examples/sample-input-lldb-for-async-hang.json` is the same bug routed to
`rust-lldb` instead — the flagship anti-pattern — and audits `pass: false` with a `critical`
`debugger-attached-to-async-hang` finding.

## Worked Example (index)

The flagship worked example is **`examples/dyld-segfault-onnxruntime.md`** — a real-shaped session
where an onnxruntime native addon segfaults a daemon on startup because `libonnxruntime.dylib` is
not on the dyld search path. It walks the full diagnosis (`DYLD_PRINT_LIBRARIES`, `otool -L`,
reading `@rpath`, `nm`/`c++filt`) and all four fixes, ending at detect-and-disable so the daemon
never dies for a missing optional library. A second transcript,
**`examples/async-stall-tokio-console.md`**, finds a `.await`-free loop starving the Tokio executor
via the `never-yielded` warning. See `examples/INDEX.md`.

## Reference Files

Load only the one that matches the bug in front of you. See `references/INDEX.md`.

| File | Consult when |
|------|--------------|
| `references/01-tracing-and-async.md` | `tracing`/`tracing-subscriber` setup, `#[instrument]`, EnvFilter/RUST_LOG grammar, JSON logs, tokio-console, stuck/cancelled futures, the two-executor footgun |
| `references/02-native-ffi-and-dyld.md` | macOS dyld load failures, `@rpath`/`@loader_path`, `DYLD_*` + SIP, `otool`/`install_name_tool`/`nm`/`c++filt`, codesign-after-edit, `dlerror`/`libloading`, FFI panic UB |
| `references/03-profiling-and-memory.md` | `cargo flamegraph`, `samply`, Instruments/`xctrace`, reading a flamegraph, Miri (what it catches/misses, MIRIFLAGS) |
| `references/04-panics-and-heisenbugs.md` | `RUST_BACKTRACE`, panic hooks, `catch_unwind`, abort vs unwind, `RUST_MIN_STACK` vs `recursion_limit`, heisenbugs, ThreadSanitizer/AddressSanitizer |
| `references/05-lldb-and-build-link.md` | `rust-lldb`/`rust-gdb`, pretty-printers, regex breakpoints for generics, why async backtraces lie, split-debuginfo, `cargo build -v`, `cargo tree -d`/`-i`, linker errors |

## Examples

| Example | Walks through |
|---------|---------------|
| `examples/dyld-segfault-onnxruntime.md` | A native addon segfaulting a daemon for a missing `libonnxruntime.dylib`, diagnosed and fixed four ways |
| `examples/async-stall-tokio-console.md` | A blocking loop starving the Tokio executor, found via tokio-console's `never-yielded` warning |

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Changelog — rust-debugging-mastery — - `SKILL.md` index: thesis (match the tool to the bug's shape), a symptom→tool decision-point Mermaid flowchart, a Core Capabilities table, 
- [`README.md`](README.md) — rust-debugging-mastery — Expert-level Rust debugging beyond `println!` and `dbg!`.

**`examples/`**
- [`examples/INDEX.md`](examples/INDEX.md) — Examples — Real-shaped debug-session transcripts.
- [`examples/async-stall-tokio-console.md`](examples/async-stall-tokio-console.md) — Worked example: a daemon that "hangs" with one core pinned — **Symptom.** A Tokio-based daemon stops responding to its HTTP health check after a few minutes under load.
- [`examples/dyld-segfault-onnxruntime.md`](examples/dyld-segfault-onnxruntime.md) — Worked example: a native addon segfaults the daemon on startup — **Symptom.** A Rust/Node daemon that uses an onnxruntime embedding model dies immediately on launch on a colleague's Apple Silicon Mac — no 
- [`examples/sample-input-lldb-for-async-hang.json`](examples/sample-input-lldb-for-async-hang.json) — sample input lldb for async hang (data/schema)
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/01-tracing-and-async.md`](references/01-tracing-and-async.md) — Tracing, structured logging, and async debugging — > Crate versions current as of June 2026: `tracing` 0.1.44, `tracing-subscriber` 0.3.22, > `console-subscriber` 0.5.0.
- [`references/02-native-ffi-and-dyld.md`](references/02-native-ffi-and-dyld.md) — Native FFI & macOS dyld debugging — > The highest-value section: a missing or mis-pathed `.dylib` does not throw — on a hard load > failure **dyld aborts the entire host proces
- [`references/03-profiling-and-memory.md`](references/03-profiling-and-memory.md) — Profiling hot paths & finding UB with Miri — Two questions: *"where is the time going?"* → flamegraph/samply/Instruments.
- [`references/04-panics-and-heisenbugs.md`](references/04-panics-and-heisenbugs.md) — Panics, backtraces, and heisenbugs — --- Default panic output (verbatim, from The Book): `full` adds the frames `=1` trims for readability.
- [`references/05-lldb-and-build-link.md`](references/05-lldb-and-build-link.md) — rust-lldb / rust-gdb and build/link debugging — The stepping-debugger question (*"what is the state at this line?"*) plus the compile/link layer (*"why won't this build or link?"*).
- [`references/INDEX.md`](references/INDEX.md) — References — Load only the file that matches the bug in front of you.

**`schemas/`**
- [`schemas/debug-plan.schema.json`](schemas/debug-plan.schema.json) — debug plan.schema (data/schema)

**`scripts/`**
- [`scripts/debug_plan_audit.mjs`](scripts/debug_plan_audit.mjs)

<!-- END BUNDLE INDEX -->
