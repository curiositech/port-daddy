# Examples

Self-contained, compile-checked Rust files. Each builds and runs its tests with plain
`rustc` (no crate needed): `rustc --test --edition 2021 <file> -o /tmp/out && /tmp/out`.

- `typestate_request.rs`: a type-state request builder where calling `send()` before the
  URL and method are set is a *compile error*, not a runtime check. Demonstrates uninhabited
  state markers, `PhantomData<S>`, transitions that consume `self`, and that all states share
  one memory layout. Pairs with `references/01-type-state-and-newtypes.md`.
- `error_architecture.rs`: the error seam — a library `thiserror`-style enum (matchable,
  with the hand-written `From` impl that `?` relies on) collapsing into an anyhow-style
  application error via a `.context()` extension trait. Dependency-free so it compiles with
  plain `rustc`; the comments show the real `thiserror`/`anyhow` forms. Pairs with
  `references/03-error-architecture.md`.
