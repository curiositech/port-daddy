# Cooperative Harbor local history evidence, 2026-09-10

Scope: one CH2 slice in the [approved implementation ledger](../../../strategy/cooperative-harbor-implementation.md),
following the [identity/routing foundation](cooperative-foundations-evidence.md).
This does not complete CH2 or enable shared admission, recovery or automation.

## Implementation and checks

- [x] Use the existing HarborBuffer's per-incarnation Loro UndoManager. No string
  snapshots or global document rollback; one accepted replacement per history
  item, bounded to 100 items. Disk seed and imported history are excluded.
- [x] Emit the newly authored undo/redo delta through the same foreground/mirror
  pipeline as typing. Mirrored imports cannot author or populate local history.
- [x] Preserve concurrent remote edits and restored authorship, Unicode boundaries,
  reversed unaffected selections, cache invalidation and duplicate-delivery safety.
- [x] Refuse history replay before touching operations, history stacks, selection
  or composition if another replica has a claim. Release permits retry; redo
  rechecks claims. Ordinary adjacent edits stay region-scoped.
- [x] Map Command-Z/Shift-Command-Z on macOS; Ctrl-Z/Shift-Ctrl-Z/Ctrl-Y on other
  platforms. Reject extra modifier chords. Accepted history cancels stale IME
  composition; rejected history preserves it.
- [ ] Add canonical affected-operation preview/admission, including Loro's ability
  to skip obsolete items. Until then, history is held for any other-replica claim,
  even an adjacent one. Checking only the caret would be an enforcement hole.
- [ ] Typing/IME undo grouping, edit-associated selection restoration, durable
  local history and native menu/task-flow proof. Current undo preserves the
  current selection via stable anchors; it does not restore an earlier selection.

From `core/`, using cached dependencies with no service starts:

```sh
cargo test --offline -q -p pd-console --bin pd-console-repl editor_
cargo test --offline -q -p pd-console --test loro_replay_convergence
cargo check --offline -q -p pd-console --features gpui,gpui/runtime_shaders --bin pd-console
```

Results: 99 selected editor/input/claim tests and 42 buffer/codec/replay tests
passed. The integration target rehosts modules, so these are not 141 unique
tests. Native Rust type-check passed with the existing runtime-shader feature.
Unused-code warnings remain. Cargo's unrelated workspace lockfile resolution
changes are excluded; this is not a locked-build claim. No new dependency.

Tests exercise concurrent same-line Unicode inserts, original author restoration
after deletion/replacement, remote edits between undo and redo, clearing redo on
new local edits, history capacity, mirror read-only enforcement, claim refusal
with unchanged history/IME, claim-release retry, reversed selections and cache
reuse. Review is solo under the halt, not independent adversarial review.

## Delivery boundary

The native app was not launched. Screenshots, a real task-flow recording, native
IME/keyboard accessibility testing and normal release-packaging proof remain
open. No visual exemption is claimed for the native interaction change. The
existing missing Metal toolchain is not repaired by the runtime-shader check.
No daemon, paid agent, deployment or shared-session admission was activated.

The operator explicitly authorized the scoped GitHub App publication path on
2026-09-10. App authorship is publication identity, not global Fleet-pause proof
and not independent review. Exact PR/check receipts belong in the PR bodies;
the full product and protected merge gates remain open.
