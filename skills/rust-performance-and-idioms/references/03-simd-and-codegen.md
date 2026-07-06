# 03 — SIMD, dispatch & inlining, binary size & compile time

> Sources: portable-simd RFC 2325
> (<https://rust-lang.github.io/rfcs/2325-stable-simd.html>), the Rust
> Performance Book — Build Configuration
> (<https://nnethercote.github.io/perf-book/build-configuration.html>), the Cargo
> Profiles reference, and `johnthagen/min-sized-rust`.

## SIMD: autovectorize first, intrinsics last

### Step 1 — make the scalar loop autovectorizable

LLVM will emit vector instructions for a plain loop *if you let it*: contiguous
slices, no early `return`/`break` inside, and a length it can reason about.
`chunks_exact` is the cheat code — it hands the compiler a known-multiple length
and a remainder, so the main loop has no per-element bounds check:

```rust
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.chunks_exact(8)
        .zip(b.chunks_exact(8))
        .map(|(x, y)| x.iter().zip(y).map(|(p, q)| p * q).sum::<f32>())
        .sum()
}
```

### Step 2 — tell the compiler what CPU it may target

The autovectorizer only emits instructions the target allows. The default
target is conservative (baseline SSE2 on x86-64) — it will **not** use AVX2
unless told. Two ways:

```bash
# Whole build, tuned to THIS machine (great for servers you control):
RUSTFLAGS="-C target-cpu=native" cargo build --release

# Or a specific floor in .cargo/config.toml:
# [build] rustflags = ["-C", "target-cpu=x86-64-v3"]   # ~= AVX2 + FMA baseline
```

Measured reality: an AVX2 path can be ~2× a SSE4.1 path, which is itself ~10×
the scalar fallback, on large inputs (Nick Wilcox's autovec writeup). But **a
binary built with `+avx2` crashes with SIGILL on a CPU without AVX2** — and only
~75% of consumer machines have it. So either pin `target-cpu` for hardware you
control, or runtime-dispatch.

### Step 3 — runtime feature detection (portable binaries)

```rust
fn process(data: &[f32]) -> f32 {
    #[cfg(target_arch = "x86_64")]
    if is_x86_feature_detected!("avx2") {
        return unsafe { process_avx2(data) }; // #[target_feature(enable="avx2")] fn
    }
    process_scalar(data)                       // always present
}
```

A `#[target_feature]` fn is `unsafe` to call (the caller asserts the feature is
present); the detection check is what makes that sound.

### Step 4 — `std::simd` (portable SIMD) when autovectorization fails

`std::simd` (the `portable_simd` feature, **nightly only** as of 2026) gives a
portable `f32x8`-style API that lowers to the best instruction set per target. It
selects the implementation per target, so the same source compiles for
AVX-512/AVX2/SSE. Reach for it only when autovectorization provably can't see the
pattern — shuffles, horizontal reductions, masked ops. On stable, the equivalent
is `std::arch` intrinsics behind feature detection (verbose, `unsafe`).

**When NOT to SIMD at all**: the loop isn't hot (profile said so); the data isn't
contiguous; or the algorithm is the problem (a better algorithm beats SIMD on a
bad one every time).

## Dispatch: `Box<dyn Trait>` vs generics

| | Static (generics, `impl Trait`) | Dynamic (`Box<dyn Trait>`, `&dyn`) |
|---|---|---|
| Dispatch | Monomorphized, inlinable, zero call overhead | Vtable indirection, not inlined |
| Code size | One copy **per type** → can bloat + slow compiles | One copy total → smaller binary |
| Hot inner loop | Prefer this — the call disappears | Avoid; the indirect call blocks inlining/vectorization |
| Heterogeneous collection | Awkward | Natural (`Vec<Box<dyn Trait>>`) |

Rule: **generics in the hot path, `dyn` at the boundaries.** A `Vec<Box<dyn
Fn>>` of plugins is fine; a `dyn` call *inside* a million-iteration loop is a
missed inline and a missed vectorization. But over-monomorphization bloats the
binary and balloons compile time (see `cargo llvm-lines` below) — `dyn` is the
right call for cold, polymorphic code.

## `#[inline]` — where it actually pays

The compiler inlines aggressively within a crate already. `#[inline]` matters
mainly **across crate boundaries**, where without it (or LTO) the callee may not
be available to inline. Annotate small, hot, cross-crate functions
(`#[inline]`); reserve `#[inline(always)]` for tiny wrappers you've *measured*,
because forcing inlining of a large fn bloats code and can slow things via
i-cache pressure. **When NOT to**: large functions, cold paths, or anything you
haven't benchmarked — trust the optimizer by default.

## Binary size & compile time

Defaults leave performance and size on the table. The knobs (Cargo profiles):

```toml
# Maximum runtime speed (a CLI/server you ship):
[profile.release]
lto = "thin"          # whole-program inlining across crates: often +10–20% speed
codegen-units = 1     # fewer parallel units → better optimization, slower compile
panic = "abort"       # drop unwinding tables (also shrinks the binary)
strip = true          # remove symbols/debug info from the shipped artifact

# Minimum size (embedded, wasm, tiny CLI):
[profile.release]
opt-level = "z"       # optimize for size ("s" is a middle ground)
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true
```

- **`lto`**: `"thin"` gets most of `"fat"`'s win for far less compile time —
  start there. LTO can both speed up *and* shrink, at compile-time cost.
- **`codegen-units = 1`**: better optimization + smaller output, slower builds.
  Leave it default in dev.
- **`opt-level`**: `3` = speed (default release), `"s"`/`"z"` = size. `"z"` can
  occasionally be *faster* if your bottleneck is i-cache — measure, don't assume.
- **`panic = "abort"`**: removes unwinding machinery; you lose `catch_unwind`.

### Find the bloat

```bash
cargo install cargo-bloat cargo-llvm-lines
cargo bloat --release --crates          # which crates own the bytes
cargo bloat --release -n 20             # biggest individual functions
cargo llvm-lines | head -20             # which generics monomorphize the most → de-generify or Box them
```

`cargo-bloat` finds what fills the binary; `cargo-llvm-lines` finds the generic
functions whose instantiations blow up both size and compile time — the highest-
leverage targets for de-monomorphization. The min-sized-rust guide chains these
(plus `build-std` to LTO the stdlib itself) for extreme cases.

**When NOT to tune the profile**: dev/CI builds where compile time dominates
(keep defaults / `codegen-units` high); code that's neither size- nor latency-
constrained. And always benchmark the *shipped* profile — these knobs trade off
against each other and occasionally regress speed.

## Sources

- portable-simd / RFC 2325: <https://rust-lang.github.io/rfcs/2325-stable-simd.html>,
  project: <https://github.com/rust-lang/portable-simd>
- "The state of SIMD in Rust in 2025": <https://shnatsel.medium.com/the-state-of-simd-in-rust-in-2025-32c263e5f53d>
- Auto-vectorization (Nick Wilcox): <https://www.nickwilcox.com/blog/autovec2/>
- Build Configuration (perf book): <https://nnethercote.github.io/perf-book/build-configuration.html>
- Cargo profiles: <https://doc.rust-lang.org/cargo/reference/profiles.html>
- min-sized-rust: <https://github.com/johnthagen/min-sized-rust>
- cargo-bloat: <https://github.com/RazrFalcon/cargo-bloat>
