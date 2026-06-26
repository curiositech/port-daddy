# 05 — Idiomatic Rust cheatsheet + unsafe done right

> Sources: the Rust API Guidelines
> (<https://rust-lang.github.io/api-guidelines/>), Rust by Example, and the Miri
> project (<https://github.com/rust-lang/miri>).

Idiomatic Rust is usually also *fast* Rust — the idioms exist because they let
the optimizer and the type system do their jobs. This is the "make it clean"
half of the skill. None of these should pessimize readability; if an idiom makes
code harder to read for no measured win, skip it.

## Type-level idioms

### Newtype over primitives

```rust
// Smell: everything is a u64; nothing stops you passing a UserId where a PortId goes.
fn connect(user: u64, port: u64) { /* ... */ }

// Fix: newtypes make the type system catch the mix-up, at ZERO runtime cost.
struct UserId(u64);
struct PortId(u16);
fn connect(user: UserId, port: PortId) { /* ... */ }
```

Newtypes are a zero-cost wrapper (`#[repr(transparent)]` if you need layout
identity for FFI). They hide representation, let you `impl` foreign traits
(orphan-rule workaround), and make precise API promises. **When NOT to**: throw-
away local code where the wrapping noise outweighs the safety.

### `impl Trait` returns instead of boxing

```rust
// Smell: heap-allocates + dynamic dispatch for an iterator you own.
fn evens(v: &[i32]) -> Box<dyn Iterator<Item = i32> + '_> {
    Box::new(v.iter().copied().filter(|x| x % 2 == 0))
}

// Fix: impl Trait — static dispatch, no allocation, the concrete type stays hidden.
fn evens(v: &[i32]) -> impl Iterator<Item = i32> + '_ {
    v.iter().copied().filter(|x| x % 2 == 0)
}
```

**When you still need `Box<dyn>`**: returning *different* concrete types from
different branches, or storing heterogeneous values in a collection. `impl
Trait` is one hidden-but-fixed type; `dyn` is many types behind a vtable.

### Builders for ergonomic optional config

For structs with many optional fields, a builder beats a 9-argument constructor
and beats `Default` + field mutation when you want validation. Keep it cheap —
consume `self` and return `Self` so it's move-based, not allocation-based.
**When NOT to**: 1–3 fields; a builder is ceremony there.

## Control-flow idioms (also clearer codegen)

### `let-else` for early-return unwrapping

```rust
// Smell: rightward drift, the happy path buried inside the match.
let port = match registry.get(name) {
    Some(p) => p,
    None => return Err(Error::NotFound),
};

// Fix: let-else keeps the happy path at the top level.
let Some(port) = registry.get(name) else {
    return Err(Error::NotFound);
};
```

### `matches!` for boolean pattern tests

```rust
if matches!(state, State::Ready | State::Idle) { /* ... */ }   // vs a 4-line match returning bool
```

### Exhaustive matches (no catch-all on your own enums)

Match every variant of an enum you own — **don't** add `_ => {}`. When you add a
variant later, the compiler points you at every site that must handle it. A `_`
arm silently swallows the new case and becomes a bug. (Catch-all is fine for
foreign `#[non_exhaustive]` enums where you *can't* be exhaustive.)

### `?`-friendly errors

Make functions return `Result<T, E>` where `E: From<...>` the underlying errors,
so `?` composes. Use `thiserror` to derive `From` + `Display` for libraries; use
`anyhow::Result` for application code where you just want context and a backtrace.

```rust
#[derive(thiserror::Error, Debug)]
enum PortError {
    #[error("port {0} is in use")] InUse(u16),
    #[error(transparent)] Io(#[from] std::io::Error),   // `?` on std::io now Just Works
}
```

**Perf note**: keep the `Err` variant small. A `Result<T, BigError>` makes the
`Ok` path carry the size of the big error too (an enum is as big as its largest
variant) — box a large error (`Box<dyn Error>` / `Box<BigError>`) so the happy
path stays lean. This ties straight back to reference 02's enum-sizing rule.

### Other small wins

- `if let ... && ...` (let-chains) and `Option::is_some_and` flatten nesting.
- Iterators over index loops (no bounds checks, autovectorizable — reference 03).
- `#[must_use]` on functions whose result must not be ignored (correctness, free).

## Unsafe done right

`unsafe` is sometimes the correct tool (FFI, a measured hot loop, lock-free
data structures). It is never a casual one. The discipline:

1. **Justify it.** Only after a profile proved the safe version is the
   bottleneck, or because there's no safe alternative (FFI, intrinsics). "Bounds
   checks feel slow" is not justification — the optimizer often removes them.
2. **Encapsulate it.** Wrap `unsafe` in a *safe* API whose type signature makes
   misuse impossible. The `unsafe` is an implementation detail, not the interface.
3. **Document the invariant.** Every `unsafe` block gets a `// SAFETY:` comment
   stating exactly what invariant makes it sound and why it holds here.

   ```rust
   // SAFETY: `idx < self.len` is guaranteed by the caller-facing bound check in
   // `get()` above; the slice is non-empty and `idx` was just validated.
   let val = unsafe { self.data.get_unchecked(idx) };
   ```

4. **Check it with Miri.** Miri is an interpreter that detects undefined
   behavior — out-of-bounds, use-after-free, invalid values (a `bool` that isn't
   0/1), data races, provenance violations — that the compiler and normal tests
   miss.

   ```bash
   rustup +nightly component add miri
   cargo +nightly miri test
   ```

   Miri only checks code paths that actually *run*, so it's only as good as your
   tests — write tests that exercise the `unsafe` path. It's slow; run it in CI
   on the `unsafe`-touching crates, not on every push of everything.

**When NOT to use unsafe**: to silence the borrow checker (restructure instead);
for a speed win you haven't measured; anywhere a safe abstraction (`Cell`,
`RefCell`, `slice::split_at_mut`, `chunks_exact`) already exists. Every `unsafe`
line is a maintenance liability and an audit surface forever.

## Sources

- Rust API Guidelines: <https://rust-lang.github.io/api-guidelines/>
- Newtype pattern: <https://doc.rust-lang.org/rust-by-example/generics/new_types.html>
- `impl Trait`: <https://doc.rust-lang.org/book/ch10-02-traits.html#traits-as-parameters>
- thiserror / anyhow: <https://docs.rs/thiserror/>, <https://docs.rs/anyhow/>
- Miri: <https://github.com/rust-lang/miri>
- Unsafe Rust (the book): <https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html>
