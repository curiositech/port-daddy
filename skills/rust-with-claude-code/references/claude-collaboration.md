# Collaborating with Claude on Rust — Workflow, Errors, Conventions

> This is the human↔AI protocol layer: what to share, what to push back on, and the
> project's settled idioms so Claude proposes them by default.

## Session startup checklist

```bash
cd core/pd-console   # or core/kernel, etc.
cargo check          # fast semantic check
cargo clippy         # lints + real bug detection
cargo test           # the gate
```

Open the session by telling Claude the baseline: *"cargo check passes, clippy clean, 23
tests green."* Claude then reasons from truth instead of guessing the build state. After a
change, re-run and report the delta.

## Sharing errors — the constraint shape, not the first line

Always paste: (1) the **full** rendered diagnostic with the error code, (2) 10–15 lines of
surrounding code, (3) one sentence of intent. Claude pattern-matches on the *constraint
shape* (E0502 "mutate while borrowed", E0382 "use after move"), so the code and the note/
help lines matter more than your prose. `scripts/cargo_diagnostics.py` captures exactly
this digest (`paste_to_claude` field) so you don't hand-trim.

## The autonomous-edit invocation

When you want Claude to fix-and-verify in a loop rather than hand you a patch, give it the
verify command up front:

> "Fix the E0499 in `lane_pane.rs`. After each edit run
> `python3 skills/rust-with-claude-code/scripts/cargo_diagnostics.py run --crate
> core/pd-console` and iterate until it reports `ok:true`. Do not change the public `Pane`
> signature; reshape the borrow per `references/borrow-checker.md`."

This binds the agent to (a) a measurable done-condition (the digest's `ok:true`), and (b)
the project's constraints (object-safety, the boxed-future signature). Without the explicit
verify loop, an agent tends to declare victory on the first compile.

## Settled idioms — so Claude proposes them by default

| Topic | The project's answer |
|-------|----------------------|
| Errors | `anyhow::Result` + `.context("what we were doing")` on every `?`. Never `.unwrap()` outside tests. |
| Async on a `dyn` trait | Hand-rolled `Pin<Box<dyn Future + Send + 'a>>`, **not** `#[async_trait]` (`ffi-and-async.md`). |
| Cross-thread sharing | `mpsc` channels (producer owns state), **not** `Arc<Mutex<T>>`. |
| Async tests | `#[tokio::test]`, never `#[test]` on an async fn. |
| Strings | `&'static str` for literals; `SharedString` for interned UI text (cheap clone); `Cow<'static, str>` for static-or-owned; `"x".into()` over `String::from("x")`. |
| Feature flags | Explicit in `Cargo.toml` (`tokio = { features = [...] }`) — never implicit. |
| Visibility | Binary crate → prefer `pub(crate)`; reserve `pub` for cross-crate-in-workspace use. |
| FFI export | `#[no_mangle] extern "C"`, `catch_unwind`, guard null/len/utf8/parse, fail closed, `# Safety` doc, caller frees (`ffi-and-async.md`). |

## anyhow error pattern

```rust
use anyhow::{Context, Result};
pub async fn fetch(&self, path: &str) -> Result<serde_json::Value> {
    let resp = self.http.get(format!("{}{}", self.base, path))
        .send().await.context(format!("GET {path}"))?;     // context on every ?
    let v = resp.json().await.context("parse JSON")?;
    Ok(v)
}
```

`.context(...)` makes the error *chain* readable end to end — without it, a deep failure
prints a bare `connection refused` with no breadcrumb. This is why `view()`'s error state
(in the console) can show something useful.

## What to push back on when Claude suggests it

- ✗ `.unwrap()` → "Use `?` or `.ok_or_else()` in non-test code."
- ✗ `#[async_trait]` → "We box the future by hand to stay object-safe and crate-free."
- ✗ `Arc<Mutex<T>>` across threads → "We use `mpsc`; `Arc<Mutex>` blocks the renderer."
- ✗ `#[test]` on an async fn → "Use `#[tokio::test]`."
- ✗ Mutating `self` during `render` → "GPUI renders are pure; mutate in event handlers."
- ✗ An FFI export without `catch_unwind` / null guards → "Panics across C ABI are UB; fail
  closed, never null."
- ✗ `RUST_MIN_STACK` for a gpui compile error → "It's a `recursion_limit`, not a runtime
  stack." (`gpui-rust-console/references/build-and-ci.md`.)

## Git discipline (from the project's hard rule)

Background agents must **never** `git add -A` (it sweeps unrelated dirty files; ADR 0001 in
windags-skills documents the incident). Stage explicit paths. Long-running work goes in a
worktree under `~/coding/tmp/`, never `/tmp`. Re-run `cargo test` before every commit; the
zero-failure norm is the baseline, not an aspiration.
