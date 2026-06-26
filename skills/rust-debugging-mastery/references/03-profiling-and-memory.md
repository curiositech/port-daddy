# Profiling hot paths & finding UB with Miri

Two questions: *"where is the time going?"* → flamegraph/samply/Instruments. *"is this UB?"* →
Miri (+ sanitizers, see `04-panics-and-heisenbugs.md`).

> Symbols are not optional. CPU profiling and source-level frames need debug info **in the
> optimized build**:
> ```toml
> [profile.release]
> debug = true            # full debug info; or use a dedicated profile (below)
> ```

---

## 1. `cargo flamegraph` (flamegraph-rs/flamegraph)

```bash
cargo install flamegraph
cargo flamegraph                          # profile the default release bin → flamegraph.svg
cargo flamegraph --bin=myprog
cargo flamegraph -- run --my-arg v        # args after `--` go to the binary
cargo flamegraph --test test_name         # profile a test
cargo flamegraph --bench some_bench -- --bench
cargo flamegraph --dev                    # profile the dev (unoptimized) build
cargo flamegraph -o my.svg --open
```

Platform mechanics:

- **Linux** uses `perf`. Needs `linux-tools-*` and unprivileged perf access:
  `echo -1 | sudo tee /proc/sys/kernel/perf_event_paranoid`. With lld/mold on recent Rust you
  may need `rustflags = ["-Clink-arg=-Wl,--no-rosegment"]`.
- **macOS** uses `dtrace`, **requires `sudo`**, and SIP can restrict dtrace on newer macOS —
  this is the usual reason to prefer `samply`.

---

## 2. `samply` (mstange/samply) — usually the better macOS choice

```bash
cargo install --locked samply
samply setup                              # macOS: one-time self-signing for process attach (no sudo for the common path)
samply record ./target/release/myprog [args]
```

Opens the **Firefox Profiler** UI (profiler.firefox.com) in your browser; cross-platform
(macOS/Linux/Windows). Linux needs perf access (`sudo sysctl kernel.perf_event_paranoid=1` or
`sudo setcap 'cap_perfmon+ep' $(which samply)`). A dedicated profile keeps `release` lean:

```toml
[profile.profiling]
inherits = "release"
debug = true
```

```bash
cargo build --profile profiling && samply record ./target/profiling/myprog
```

---

## 3. macOS Instruments

Easiest from Cargo via `cargo-instruments` (cmyr/cargo-instruments):

```bash
cargo install cargo-instruments
cargo instruments -t time --bin myprog    # Time Profiler → a .trace you open in Instruments
# templates: time (Time Profiler), alloc (Allocations), leaks (Leaks)
```

Raw `xctrace` (confirm the template name with `xcrun xctrace list templates` — Apple labels it
`'Time Profiler'` in most versions):

```bash
xcrun xctrace list templates
xcrun xctrace record --template 'Time Profiler' \
  --output out.trace --launch -- ./target/release/myprog   # --launch must be LAST
```

---

## 4. Reading a flamegraph (don't misread the X-axis)

- **Width = total CPU time** in that function (self + children). Widest boxes = hottest.
- **X-axis is NOT a timeline.** Left→right is merged/alphabetical, not chronological. Do not read
  it as "this happened then that".
- **Y-axis = stack depth** — `main` near the bottom, leaf calls on top. Color is random.
- **Method**: find the **widest plateau** — the broad flat top is where wall-CPU actually goes.
  A tall narrow spike is deep but cheap; a wide shallow block is the bottleneck.

---

## 5. Miri — the UB interpreter

```bash
rustup +nightly component add miri
cargo +nightly miri test                  # run the test suite under Miri
cargo +nightly miri run                   # run a binary under Miri
MIRIFLAGS="..." cargo +nightly miri test  # pass interpreter flags
```

### What Miri CATCHES

- Out-of-bounds access and **use-after-free**
- Reads of **uninitialized** memory
- **Invalid type invariants** — non-`0/1` bools, invalid enum discriminants
- **Dangling / invalid references**, insufficient **alignment**
- Violated intrinsic preconditions (e.g. reaching `unreachable_unchecked`)
- **Data races** and weak-memory effects
- **Aliasing violations** under **Stacked Borrows** / **Tree Borrows**
- **Memory leaks** (allocations still live at exit)

UB is reported under a stable header: `error: Undefined Behavior: <description>`. (The exact
per-case body text shifts between nightly versions — reproduce locally before quoting a specific
body.)

### What Miri MISSES — know the limits

- It is an **interpreter, not a verifier**: it only checks the code paths your run actually
  executes. Unexecuted branches get **zero** coverage. Passing Miri ≠ "sound".
- **No real FFI / syscalls** — it cannot call most foreign functions; it errors with an
  unsupported-operation message. So Miri cannot validate your dyld/FFI code from `02-…` — use the
  real tooling there.
- **Slow** — orders of magnitude slower than native; scope it to the unsafe modules/tests.
- One interleaving per run; concurrency bugs may evade a single seed.

### Useful `MIRIFLAGS`

```
-Zmiri-tree-borrows            # Tree Borrows aliasing model (vs default Stacked Borrows)
-Zmiri-disable-stacked-borrows # turn off aliasing checks entirely
-Zmiri-ignore-leaks            # don't report leaks at exit
-Zmiri-disable-isolation       # allow host access: real clock, getrandom, some FS
-Zmiri-many-seeds=0..32        # re-run with many RNG seeds to shake out nondeterministic concurrency
-Zmiri-symbolic-alignment-check
-Zmiri-seed=<n>                # fix the RNG seed for reproducibility
-Zmiri-backtrace=full          # full backtrace on UB
```

Pattern: a flaky `unsafe`-heavy module → `cargo +nightly miri test -p that_crate` with
`MIRIFLAGS="-Zmiri-many-seeds=0..64 -Zmiri-tree-borrows"` to surface aliasing and race bugs that
native runs hide.

---

## Sources

- [flamegraph-rs/flamegraph README](https://github.com/flamegraph-rs/flamegraph)
- [mstange/samply README](https://github.com/mstange/samply)
- [cmyr/cargo-instruments](https://github.com/cmyr/cargo-instruments) · [xctrace(1)](https://keith.github.io/xcode-man-pages/xctrace.1.html)
- [rust-lang/miri README](https://github.com/rust-lang/miri)
- [Cargo profiles (debug, split-debuginfo)](https://doc.rust-lang.org/cargo/reference/profiles.html)
