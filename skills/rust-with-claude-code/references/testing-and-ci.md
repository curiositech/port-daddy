# Testing & the Real CI Gate

> Sources: `.github/workflows/ci.yml` (`rust-console`, `rust-console-gpui`, `rust-kernel`
> jobs), `core/pd-console/src/pane.rs` and `maritime.rs` (in-file test modules),
> `core/kernel/pd-anchor/src/ffi.rs` (FFI tests + parity vectors). Corrects earlier folklore.

## The testing contract: three states, sync, no live daemon

Every console pane proves three render states without a network or a runtime:

```rust
#[test] fn view_empty()      { /* new pane → still renders a header */ }
#[test] fn view_populated()  { /* rows → one element per row */ }
#[test] fn view_error_state(){ /* last_error set → error block present */ }
```

`view()` is sync, so these need **no tokio runtime**. They run on the Linux CI gate where
gpui never compiles. `templates/async_pane_test.rs.tmpl` scaffolds the variant where you
also want to exercise an async `refresh`/`mutate`.

## Async tests: `#[tokio::test]`, never `#[test]` on an async fn

```rust
#[tokio::test]
async fn refresh_fails_gracefully_without_a_daemon() {
    let client = DaemonClient::new("http://127.0.0.1:1".into());
    // No daemon at :1 → refresh records last_error, does not panic
    assert!(client.agents().await.is_err());
}
```

`#[test]` on an `async fn` gives you a `Future` that's never polled — the test passes
vacuously. Always `#[tokio::test]` for async. `pd-console`'s `[dev-dependencies]` pull
`tokio` with the `["rt", "macros"]` features for exactly this.

## Object-safe boxed futures need no runtime if they don't yield

`pane.rs::tests` proves the `mutate` dispatch reaches the active surface using a hand-rolled
`futures_block_on` (a no-op `Waker`) instead of tokio — because the test's futures never
actually await anything. When your boxed future is `Ok(())` with no real await, you can
block on it with a trivial waker and keep the test runtime-free. (Read `pane.rs` for the
exact 15-line helper.)

## What CI actually runs (verbatim) — and what it does NOT

| Job | Runner | Commands |
|-----|--------|----------|
| `rust-console` | ubuntu | `cargo check` then `cargo test` (cwd `core/pd-console`) |
| `rust-console-gpui` | macOS | `cargo build --features gpui --bin pd-console` (path-gated) |
| `rust-kernel` | ubuntu | `cargo check --workspace` then `cargo test --workspace` (cwd `core/kernel`) |

**There is no `RUST_MIN_STACK` and no `--bin pd-console-repl` filter in CI.** Plain
`cargo test` (no filter) is the gate. Earlier skill drafts asserted both; they were wrong.
The gpui macro stack issue is a *compile-time* recursion limit fixed by
`#![recursion_limit = "512"]` in `main.rs`, not a runtime stack env var — see
`gpui-rust-console/references/build-and-ci.md`.

Use `scripts/cargo_diagnostics.py run --crate <dir>` to reproduce the check locally and get
a paste-ready error digest:

```bash
python3 skills/rust-with-claude-code/scripts/cargo_diagnostics.py run --crate core/pd-console
```

## Parity vectors: the cross-runtime gate (ADR-0054)

`rust-kernel` runs `cargo test --workspace`, which includes `tests/parity_vectors.rs`: the
Rust half asserts the canonical macaroon impl reproduces
`tests/fixtures/macaroon-parity-vectors.json` — the *same* fixture the TS suite asserts.
This is what makes "the FFI path and the TS fallback return identical results" a tested
invariant rather than a hope. The job is **always-run, not path-gated**, so a parity
divergence can never be silently skipped. When you change a kernel crypto path, regenerate
and commit the vectors and watch *both* halves stay green.

## FFI tests live in the crate (no dylib build needed)

`ffi.rs` exercises the `extern "C"` entry point in-process via a `#[cfg(test)]`
`verify_via_ffi` helper — valid grant authorizes, protected branch rejects, malformed
input fails closed without panicking. You get full coverage of the null/utf8/catch_unwind/
free contract under plain `cargo test`, no koffi, no `.dylib`. See
`references/ffi-and-async.md` and `templates/ffi_export.rs.tmpl`.

## Session-start ritual

```bash
cargo check    # fast semantic pass — catches ~90% of errors
cargo clippy   # real bugs, not just style; treat a new warning as a regression
cargo test     # the gate
cargo fmt      # before commit
```

Tell Claude your status first ("check passes, clippy clean, 23 green") so it reasons from
the real baseline, not a guessed one.
