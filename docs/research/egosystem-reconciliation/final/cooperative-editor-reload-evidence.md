# Cooperative Harbor reload-preservation evidence, 2026-09-11

Bounded CH2 continuation of the [implementation ledger](../../../strategy/cooperative-harbor-implementation.md),
stacked on the identity foundation and per-replica undo/redo slices. No stage is
complete because this regression is fixed.

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
- Retain existing buffer, replica, claims and render cache on a refused or failed
  reload. Install a new incarnation/baseline only after a clean candidate opens.
- Show reload failure through the existing key/value presentation while retaining
  code. Reserve the failed-open `error` key and `load_error()` for bufferless
  failures so native error recovery/navigation cannot replace a usable editor.
- Keep async disk reads in `spawn_blocking`; record task/read failures in the pane
  rather than propagating them and blanking other panes.

This guard is not a filesystem dirty-bit or persistence receipt. Duplicate imports
may conservatively hold reload even without a text difference. There is no
discard override, disk writer, durable private draft, save acknowledgement or
shared-session authority introduced here. App/window close and machine failure
still require the planned private persistence/unsaved-close work. No claim is made
that a retained in-memory operation survives a process restart.

## Tests

Five new headless tests cover local edits and undo/redo, preserved claims/replica/
document/cache, imported authorship, snapshot-only buffers, invalid-UTF-8 read
failure with later successful retry, sync/async parity and read-only mirrors.
The dependency-order regression sends only a later Loro delta first, verifies
that the visible frontier is unchanged, attempts reload, then supplies only the
earlier dependencies. The previously pending later text appears without resending
it, proving that the same in-memory document was retained.

`cargo test --offline -q -p pd-console` passes 16 headless targets and 882 test
executions, including repeated rehosted modules. Test scratch lives under
`coding/tmp` or crate `target/`, hooks are disabled and mock clients are local;
no Port Daddy runtime is started. Existing unused-code warnings remain. Unrelated
workspace lockfile resolution drift is excluded; no new dependencies are added.

`cargo check --offline -q -p pd-console --features gpui,gpui/runtime_shaders --bin pd-console`
passes. Native light/dark screenshots, recording, keyboard/IME/zoom/accessibility
and human task proof remain open under the app-launch halt. GUI/console skills
kept the change on the existing pane/refresh and error-presentation contracts,
without new tokens or controls. This draft is not ready for protected merge,
deployment or release.
