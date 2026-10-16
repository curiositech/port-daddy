# Cooperative Harbor reload-preservation evidence, 2026-09-11

Bounded CH2 continuation of the [implementation ledger](../../../strategy/cooperative-harbor-implementation.md),
replayed onto main after the identity, per-replica undo/redo, and device-local
save slices merged. No stage is complete because this regression is fixed.

## Defect and correction

`EditorPane::load` cleared the live buffer before attempting a disk read.
`refresh` also installed a fresh CRDT unconditionally, clearing the buffer on
read failure. Both paths could lose edits, imported authorship, history and
ephemeral coordination state. Reloading a producer mirror could independently
seed disk text instead of following the foreground's exact operations.

The two paths now share one preflight and candidate-installation routine:

- Refuse a mirror reload without reading the file.
- Preserve any operations since the successful disk-open frontier. Undoing back
  to identical text does not erase the newer edit/undo history or redo stack.
- Treat every successful import as a conservative preservation barrier, including
  duplicate and dependency-pending imports. Loro's visible state frontier does
  not advance when a later operation is waiting for missing earlier changes.
- Retain existing buffer, replica, claims, render cache, and save target on a
  refused or failed reload. Install a new incarnation and save baseline only
  after a clean candidate opens. An in-flight save also refuses reload.
- Show reload failure through the existing key/value presentation while retaining
  code. Reserve the failed-open `error` key and `load_error()` for bufferless
  failures so native error recovery/navigation cannot replace a usable editor.
- Keep async disk reads in `spawn_blocking`; record task/read failures in the pane
  rather than propagating them and blanking other panes.

This guard is not a filesystem dirty-bit or persistence receipt. Duplicate imports
may conservatively hold reload even without a text difference. A successful
device-local text save does not preserve CRDT edit and undo history, so reload
remains refused. There is no discard override, durable private draft, shared
save acknowledgement or shared-session authority introduced here. App/window
close and machine failure still require the planned private persistence and
unsaved-close work. No claim is made that an in-memory operation survives a
process restart.

## Tests

Six new headless tests cover local edits and undo/redo, preserved claims/replica/
document/cache, imported authorship, snapshot-only buffers, invalid-UTF-8 read
failure with later successful retry, sync/async parity, read-only mirrors, and
the device-local save/reload boundary.
The dependency-order regression sends only a later Loro delta first, verifies
that the visible frontier is unchanged, attempts reload, then supplies only the
earlier dependencies. The previously pending later text appears without resending
it, proving that the same in-memory document was retained.

At the original 2026-09-11 head, `cargo test --offline -q -p pd-console` passed
16 headless targets and 882 test executions. After replaying this fix on the
current main branch, the reload regressions pass, the complete headless
target graph compiles with `cargo test --offline -q -p pd-console --no-run`, and
`cargo check --offline -q -p pd-console --features gpui,gpui/runtime_shaders --bin pd-console`
passes. A full local test run stalled in the existing `claims_pane` exact-session
recovery test while local Off was active; hosted exact-head CI must establish
the full-suite verdict. No Port Daddy daemon or app was started. Existing
unused-code warnings remain; no new dependencies are added.

Native light/dark screenshots, recording, keyboard/IME/zoom/accessibility
and human task proof remain open under the app-launch halt. GUI/console skills
kept the change on the existing pane/refresh and error-presentation contracts,
without new tokens or controls. This draft is not ready for protected merge,
deployment or release.
