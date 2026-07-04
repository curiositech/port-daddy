# rust-lldb / rust-gdb and build/link debugging

The stepping-debugger question (*"what is the state at this line?"*) plus the compile/link layer
(*"why won't this build or link?"*).

---

## 1. `rust-lldb` / `rust-gdb`

`rustup` installs `rust-lldb` and `rust-gdb` wrapper scripts (in `~/.cargo/bin/`). They launch
the underlying debugger and **auto-load Rust pretty-printers / type summaries**, so std containers
render as values, not internals: **`Vec`** as `[1, 2, 3]` (not `RawVec`/ptr/len), **`String`**,
**`HashMap`**, **`Option`**, **`Result`**, and enums. Without the wrapper you see raw structs.

**Debuginfo is a precondition.** On by default for `cargo build`/`run` (debug); for release opt in
with `[profile.release] debug = true`. `-C debuginfo` levels: `0/none` (release default),
`1/limited` (no var/type info), `2/full` (= `-g`), `line-tables-only` (file/line backtraces, no
variables).

```bash
rust-lldb target/debug/myprog -- arg1 arg2
(lldb) b main.rs:42                 # by file:line
(lldb) b my_crate::my_func          # by symbol path
(lldb) run
(lldb) frame variable               # all locals in the current frame
(lldb) p expr                       # evaluate / print
(lldb) bt                           # backtrace, current thread
(lldb) bt all                       # backtrace, ALL threads  (find the lock cycle in a sync deadlock)
```

GDB equivalents: `break main.rs:42`, `info locals`, `print expr`, `bt`, `thread apply all bt`.

### The monomorphization breakpoint gotcha

A generic `fn foo<T>()` is **not** one symbol after codegen — the compiler emits a separate copy
per instantiating type (`foo::<u32>`, `foo::<String>`, …). A bare `b my_crate::foo` may bind to
only one instantiation or none. Catch them all with a **regex** breakpoint:

```
(lldb) breakpoint set -r 'my_crate::foo'        # alias: br s -r
(gdb)  rbreak my_crate::foo
```

GDB Rust-mode limits (sourceware): in a monomorphized function you cannot use the generic type
names, and GDB can't evaluate `if`/`match`/closures/operator-overloading or reference `Self`.

### Why async backtraces lie (cross-ref `01-…`)

A `bt` in a Tokio program shows the worker thread inside `Future::poll` on the *outer* future —
**not** the logical await chain, because a suspended `.await` is heap state, not a stack frame.
For async, don't reach for `bt`; use `tokio-console` or `#[async_backtrace::framed]`
(see `references/01-tracing-and-async.md`).

### Split debuginfo

`-C split-debuginfo` / `[profile.*] split-debuginfo`: `off` (DWARF in the binary), `packed`
(one sidecar — `.pdb`/`.dSYM`/`.dwp`; default on macOS + MSVC), `unpacked` (per-object). On macOS
the debugger needs the **`.dSYM`** bundle next to the binary to resolve symbols; a missing `.dSYM`
gives you address-only frames.

---

## 2. Build & link debugging

### See what cargo actually runs

```bash
cargo build -v        # print the literal rustc + linker invocations (-C, -L, -l, --edition ...)
cargo build -vv       # also dump build.rs (build-script) stdout/stderr
```

`-v` is the first move for "why is this flag/linker arg being passed" — it dumps the trailing
`cc`/`ld` command line you can rerun by hand.

### Inject flags

```bash
RUSTFLAGS="-C link-arg=-fuse-ld=lld" cargo build
RUSTFLAGS="-C target-cpu=native" cargo build --release
# or per-target in .cargo/config.toml: [target.<triple>] rustflags = ["..."]
```

### Duplicate / mystery dependencies

```bash
cargo tree -d           # ONLY crates present in MULTIPLE versions (bloats build + binary; each compiled separately)
cargo tree -i syn       # INVERT: who depends on `syn`? — find what pulls a crate in
cargo tree -e features  # why is this feature enabled
cargo tree --depth 1    # direct deps only
```

### Linker errors — what they mean in Rust

| Symptom | Usual cause | Move |
|---|---|---|
| `undefined symbol` / `undefined reference to '_Xyz'` | a `#[link]`/`-l` native lib missing or in the wrong order; `build.rs` not emitting `cargo:rustc-link-lib=` / `cargo:rustc-link-search=`; an `extern "C"` symbol absent | `cargo build -v`, inspect the trailing `cc`/`ld` line; check the `-sys` crate's `build.rs` |
| `multiple definition` / `duplicate symbol` | two crate versions of a `-sys` crate, or a native lib linked twice | `cargo tree -d <sys-crate>`, unify versions |
| backtrace shows `<unknown>` / no symbols | link OK but `.dSYM`/`.pdb`/`.dwp` sidecar missing | check `split-debuginfo`; keep the sidecar next to the binary |
| (macOS) `Library not loaded: @rpath/...` at **run** time | a *runtime* dyld failure, not a link error | `references/02-native-ffi-and-dyld.md` |

---

## Sources

- [GDB manual — Rust mode (pretty-printing, monomorphization limits)](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Rust.html)
- [rustc codegen options — debuginfo, split-debuginfo](https://doc.rust-lang.org/rustc/codegen-options/index.html)
- [cargo tree (-d / -i)](https://doc.rust-lang.org/cargo/commands/cargo-tree.html) · [cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html)
- [Tokio — Announcing async-backtrace (why async stacks differ)](https://tokio.rs/blog/2022-10-announcing-async-backtrace)
