# 02 — Allocation reduction, iterators, and cache-friendly layout

> Source of truth: The Rust Performance Book — Heap Allocations
> (<https://nnethercote.github.io/perf-book/heap-allocations.html>) and Type
> Sizes (<https://nnethercote.github.io/perf-book/type-sizes.html>).

Most "Rust is slow here" turns out to be "Rust allocates here." Allocation is a
syscall-adjacent cost plus a `memcpy` plus eventual `drop`. The flamegraph tells
you (wide `__rust_alloc`/`free`/`memcpy`/`drop_in_place`). This file is the menu
of fixes, each with its *when not to*.

## 1. Borrow instead of own

| Smell | Fix | Why |
|-------|-----|-----|
| `fn f(s: String)` for read-only use | `fn f(s: &str)` | No allocation at the call site; accepts `&String`, `&str`, literals |
| `fn g(v: Vec<T>)` read-only | `fn g(v: &[T])` | Same; slices are the universal read interface |
| `.to_string()` / `.to_owned()` to pass along | pass the borrow | Owning is the caller's job, not the helper's |
| return `String` built from a `&str` you didn't change | return `&str` / `Cow<str>` | Avoid the copy when no edit happened |

**When NOT to**: if borrowing forces a lifetime parameter that tangles three
structs together, the readability cost can exceed one allocation's cycle cost.
Own it and move on — *after* you've confirmed it isn't hot.

## 2. `Cow<str>` for "usually borrowed, sometimes owned"

```rust
use std::borrow::Cow;

/// Allocates ONLY when a replacement actually happens.
fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains('\t') {
        Cow::Owned(input.replace('\t', "    "))   // rare path: allocate
    } else {
        Cow::Borrowed(input)                       // common path: zero alloc
    }
}
```

`Cow` is the idiomatic answer to "I want to avoid allocating in the common case
but can't promise I never will." **When NOT to**: if you *always* end up owning,
`Cow` is just a more confusing `String`. Profile the branch ratio.

## 3. `SmallVec` / `ArrayVec` — stack storage for small collections

`SmallVec<[T; N]>` keeps up to `N` elements inline (no heap) and spills to a heap
`Vec` beyond that. Good when collections are *usually* tiny and you make *many*
of them.

**The honest caveat** (measured by others, reproduce before trusting): SmallVec
is *slightly slower than `Vec` for normal ops* because every access branches on
inline-vs-heap. Its real wins come from avoiding the allocation when the count is
small *and* from cache locality when you store many SmallVecs contiguously. One
report found swapping a `Vec` for a `SmallVec` gave "very small wins of up to
0.5%" — not a magic bullet.
**When NOT to**: large or unpredictable sizes; a single long-lived collection
(the one allocation is dwarfed by its lifetime). See
<http://troubles.md/posts/improving-smallvec/>.

## 4. Pre-size and reuse buffers

```rust
// Smell: repeated growth reallocations as the Vec doubles.
let mut v = Vec::new();
for x in src { v.push(transform(x)); }

// Fix: one allocation up front.
let mut v = Vec::with_capacity(src.len());
for x in src { v.push(transform(x)); }
```

`with_capacity` (and `String::with_capacity`, `HashMap::with_capacity`) turns
*log n* reallocations into *one*. rustc's own vec-growth tuning sped many of its
benchmarks by up to ~4% just by allocating better — allocation strategy is real
perf. **Reuse across iterations** rather than allocating per loop:

```rust
let mut scratch = String::new();
for item in items {
    scratch.clear();              // keeps the capacity, drops the length
    write_into(&mut scratch, item);
    consume(&scratch);
}
```

**When NOT to**: you genuinely don't know the size and over-reserving wastes
memory; or the loop runs twice. `clear()`+reuse only matters in hot loops.

## 5. Arena allocation for many same-lifetime objects

When you allocate thousands of small nodes that all die together (an AST, a
graph, a per-request scratchpad), a bump arena (`bumpalo`, `typed-arena`) makes
allocation a pointer increment and deallocation a single reset.
**When NOT to**: objects with individual lifetimes, or that must outlive the
arena — arenas free all-or-nothing.

## 6. Iterators: zero-cost, but mind the intermediates

Iterator chains compile to the same code as the hand loop (often *better*,
because bounds checks are elided) — they are genuinely zero-cost abstractions.
The cost sneaks in through **materialized intermediates**:

```rust
// Smell: three passes + two throwaway Vecs.
let a: Vec<_> = xs.iter().map(f).collect();
let b: Vec<_> = a.iter().filter(|x| pred(x)).collect();
let total: i64 = b.iter().sum();

// Fix: one lazy pass, zero intermediate Vecs.
let total: i64 = xs.iter().map(f).filter(|x| pred(x)).sum();
```

Use `fold`/`scan`/`try_fold` to thread state through one pass instead of
collecting between steps. `collect()` is for when you actually need the
materialized result. **When loops genuinely win**: complex carried state across
elements, or when you need to index neighbors — a plain `for` is clearer and the
codegen is identical. Don't contort an iterator chain to avoid a readable loop.

> Tip: `collect::<Result<Vec<_>, _>>()` and `sum()`/`product()` on iterators of
> `Result`/`Option` short-circuit correctly — idiomatic *and* allocation-light.

## 7. Cache-friendly data layout

The CPU loads memory a cache line (typically 64 bytes; 128 on Apple silicon /
x86-64 per crossbeam) at a time. Layout decides how many lines a hot loop
touches.

### Struct-of-Arrays (SoA) vs Array-of-Structs (AoS)

```rust
// AoS: if a loop only reads `health`, each iteration drags x/y/name into cache too.
struct Entity { x: f32, y: f32, health: f32, name: String }
let world: Vec<Entity> = ...;

// SoA: the health loop streams one contiguous f32 array — cache- and SIMD-friendly.
struct World { xs: Vec<f32>, ys: Vec<f32>, healths: Vec<f32>, names: Vec<String> }
```

SoA shines for column-wise hot loops (ECS, numeric kernels) and unlocks
autovectorization (reference 03). **When NOT to**: code that touches whole
records at once (AoS keeps a record on one line); SoA also hurts readability, so
reserve it for measured hot data.

### Field ordering and `size_of`

Rust's default `repr(Rust)` already reorders fields to minimize padding, so you
usually don't hand-order. But check `std::mem::size_of` for hot types — a large
enum is as big as its largest variant, so box a rare giant variant:

```rust
enum Msg { Ping, Heartbeat, Bulk(Box<[u8; 4096]>) }  // Box keeps Msg small
```

`#[repr(C)]` / `#[repr(align(N))]` matter for FFI and deliberate layout, but
opting out of `repr(Rust)`'s packing can *add* padding — measure.

### False sharing → `CachePadded`

When two threads write two different atomics that share a cache line, each write
invalidates the other core's copy — "false sharing", a silent multi-core
killer. Pad hot, independently-written values to their own line with
`crossbeam_utils::CachePadded`:

```rust
use crossbeam_utils::CachePadded;
struct Queue {
    head: CachePadded<AtomicUsize>,  // producer writes
    tail: CachePadded<AtomicUsize>,  // consumer writes — now on its own line
}
```

**When NOT to**: single-threaded data, or read-mostly shared data (no
invalidation traffic). Padding wastes memory, so apply it only to the contended
fields a profile flagged (high cache-miss / coherence-stall counts).

## Sources

- Rust Performance Book — Heap Allocations:
  <https://nnethercote.github.io/perf-book/heap-allocations.html>
- "Improving SmallVec's speed by 60%…": <http://troubles.md/posts/improving-smallvec/>
- Rust Performance Pitfalls (Llogiq): <https://llogiq.github.io/2017/06/01/perf-pitfalls.html>
- crossbeam `CachePadded`: <https://docs.rs/crossbeam-utils/latest/crossbeam_utils/struct.CachePadded.html>
- `std::borrow::Cow`: <https://doc.rust-lang.org/std/borrow/enum.Cow.html>
