---
name: rust-development-workflow
description: >-
  Run the ordinary Rust edit, compile, lint, and test loop; diagnose ownership and
  lifetime errors with intent and surrounding code; choose basic error and async
  test patterns. Use for day-to-day Rust changes in any crate. For library API
  invariants use advanced-rust-patterns; for structure selection use
  rust-data-structures-advanced; for measured optimization use
  rust-performance-and-idioms; for runtime failures use rust-debugging-mastery;
  for a pd-console pane or GPUI executor boundary use gpui-rust-console. NOT for runtime failure diagnosis, measured optimization, FFI design, or GPUI rendering.
license: Apache-2.0
metadata:
  category: Rust
  provenance:
    kind: first-party
    owners: [port-daddy]
  pairs-with: [advanced-rust-patterns, rust-data-structures-advanced, rust-debugging-mastery, gpui-rust-console]
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: Rust workflow and verification plan for a bounded change
      - kind: critique
        description: Rust code review for ownership, errors, and testability
---

# Rust Development Workflow

Use this for a bounded Rust code change or a compiler error. Work from the crate's
real `Cargo.toml`; do not assume `core/pd-console` or a particular AI assistant.

## Working loop

1. Identify the package, features, target, and currently passing gate. Preserve
   the full compiler diagnostic and 10–15 lines around the relevant code.
2. State the intended data flow: which value is read, owned, moved, mutated,
   returned, or awaited. Fix the ownership model before adding clones or locks.
3. Run `cargo check` for the affected package and target. Then `cargo fmt --check`,
   targeted tests, and `cargo clippy` with the project's feature/target settings.
4. Report exact commands and results. A passing check does not prove runtime
   behavior, and a source-present feature does not prove it is installed.

Use the repository's current commands and CI configuration when they differ.
Never start the halted local Port Daddy runtime as a Rust verification step.

## Compiler and ownership decisions

| Symptom | First move | Route if deeper |
|---|---|---|
| Read a field, then mutate its owner | Shorten the borrow; copy a small value or clone only the field when ownership really must cross the mutation | `advanced-rust-patterns` for API redesign |
| Mutate a collection during iteration | Separate discovery from mutation; apply removals in reverse index order or use `retain` | `rust-data-structures-advanced` if the container itself is wrong |
| Borrow across `.await` | Extract owned inputs before the await; keep lock and borrow guards short | `rust-debugging-mastery` for a stall |
| Error lacks context | Use `?` plus context at application boundaries; preserve matchable errors at library boundaries | `advanced-rust-patterns` for public error architecture |
| Fix involves repeated `clone()` or `Arc<Mutex<_>>` | Inspect ownership and access pattern before accepting the workaround | `rust-data-structures-advanced` or `rust-performance-and-idioms` |

For a concrete compiler error, include the full diagnostic, relevant code, and
one sentence of intent. A single copied error line often hides the borrow's
origin or trait-bound chain.

## Tests and review

- Test the behavior affected by the change, including an empty and an error
  state when those states exist. Use `#[tokio::test]` for Tokio async tests.
- Prefer `?` or an explicit branch to `unwrap()` on recoverable production paths.
- Run the actual feature-gated target. `cargo test` with default features can
  miss the binary or platform feature that changed.
- Distinguish correctness evidence from performance evidence. Profile and
  benchmark before claiming a speedup.

## Routing boundaries

- Public traits, typestate, `dyn` versus generics, interior mutability and
  error type design: `advanced-rust-patterns`.
- Arenas, stable graph IDs, inline vectors, concurrent maps and persistent
  data: `rust-data-structures-advanced`.
- Profiling, allocations, SIMD, async latency, code size: `rust-performance-and-idioms`.
- Panics, hangs, UB, FFI load failures and heisenbugs: `rust-debugging-mastery`.
- Building the C ABI and TypeScript/Bun loader: `rust-kernel-ffi`.
- `core/pd-console` pane contracts, its Tokio producer and GPUI consumer,
  layout, focus, or its exact CI gate: `gpui-rust-console`.

## Preserved source

The previous Rust pairing guidance is retained verbatim in
`references/legacy-rust-with-claude-code.md`. Its assistant-specific wording,
fixed test counts, and console examples are historical source, not universal
Rust defaults. Use `gpui-rust-console` for the active console contract.
