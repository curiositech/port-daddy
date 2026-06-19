## Summary

- **Phase 0 — Scaffold land-ready**: rebased `feat/pd-console-scaffold` onto `origin/main` (additions-only, zero conflicts). `cargo check` + `cargo test` (4 pre-existing tests) + `cargo build` all green.
- **Phase 2A — DispatchQueuePane**: new `core/pd-console/src/dispatch_pane.rs` implementing the `Pane` trait; shows sorties awaiting review from the live daemon.
- **CI — rust-console job**: added to `.github/workflows/ci.yml`; runs on every PR/push to main without touching existing jobs.

## What's new

### `core/pd-console/src/dispatch_pane.rs`
- `DispatchQueuePane` implements the existing `Pane` trait exactly (`id()`, `title()`, `view()`, `refresh()`).
- `refresh()` calls `GET {daemon}/dispatches?state=review_pending&limit=50` via `DaemonClient`.
- `view()` emits `Block` sequence: `Header("Dispatch Queue")` → `KeyVal("pending review", N)` → one `Row([id_short, goal≤50, state, $cost])` per dispatch → `Chip("N awaiting review")`.
- **Fail-closed**: daemon unreachable → `KeyVal("error", message)` only; no panic.
- Registered in `PaneRegistry` at startup; accessible via `:dispatch` REPL command.
- `DaemonClient` gains `http_client()` so panes share canonical discovery without re-implementing it.

### 3 unit tests (all green)
- `view_empty_queue` — Header + count + status line + Chip(0) shape check
- `view_populated_queue` — Row field assertions (id_short ≤8 chars, goal truncation, state passthrough, cost `$` prefix)
- `view_error_state` — error path produces exactly 2 blocks with the error KeyVal

### rust-console CI job
```yaml
rust-console:
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: core/pd-console
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: Swatinem/rust-cache@v2
      with:
        workspaces: core/pd-console
    - run: cargo check
    - run: cargo test
```

## Test plan
- [ ] CI: `rust-console` job green on this PR
- [ ] CI: all existing jobs (`unit-tests`, `compiled-daemon-smoke`, `lint`, etc.) still green — nothing in this diff touches TS/JS/bun
- [ ] Manual: `cd core/pd-console && cargo test` shows 7/7 passing
- [ ] Manual: `:dispatch` in the REPL either shows the queue or a graceful error if the daemon is unreachable

---

## Visual artifacts (test plan)

Recorded with vhs against the **live daemon** (pd 3.18.0, localhost:9876). Source tape committed at `core/pd-console/docs/artifacts/console-tour.tape`.

| Pane | Screenshot |
|---|---|
| Launch + header | ![default](https://raw.githubusercontent.com/curiositech/port-daddy/b264ea22/core/pd-console/docs/artifacts/pane-default.png) |
| `:sorties` — live needs-input / working / recent buckets | ![sorties](https://raw.githubusercontent.com/curiositech/port-daddy/b264ea22/core/pd-console/docs/artifacts/pane-sorties.png) |
| `:dispatch` — fail-closed with honest status when the daemon predates the route | ![dispatch](https://raw.githubusercontent.com/curiositech/port-daddy/b264ea22/core/pd-console/docs/artifacts/pane-dispatch.png) |

Full tour GIF: [console-tour.gif](https://raw.githubusercontent.com/curiositech/port-daddy/b264ea22/core/pd-console/docs/artifacts/console-tour.gif)

### Bugs the recording caught (fixed in b264ea22)
- Sortie pane silently dropped **every** live row (strict serde: `state` vs daemon's `status`, `identity` vs `harbor`) → rendered "total 0". Now tolerant Value extraction + regression test on a captured real payload.
- Dispatch pane decoded 404 bodies as data → opaque "error decoding response body". Both panes now check HTTP status first and name the route + code.

19/19 pd-console unit tests green. `cargo build --release` clean.
