# CH2: input-aware undo boundaries

Continuation of regular PR #10141 under `harbor-editor-local-text-input`, not a
new program or completed local IDE. Publication and head receipts belong in the
regular PR. The operator halt remains in force.

## Behavior and authority

`editor_history.rs` is a pure input-boundary policy. The buffer's existing
per-incarnation Loro UndoManager is still the only operation stack. Consecutive
single-grapheme, non-whitespace typing and contiguous backspace/forward deletion
can group within 750 ms. Selected replacements, paste/cut, line breaks,
indentation and programmatic edits are isolated. Whitespace ends a word group.

Composition updates can outlast that typing interval but must continue the same
marked replacement range. Final platform commit closes the composition group.
The policy checks the exact document frontier and a local successful-import
generation, including duplicate and dependency-pending imports whose visible
frontier may not change. This counter is not a grant or authority revision.

Every range and existing live claim is checked before opening/changing a group.
Each accepted edit still commits and sends its own authored delta; grouping does
not batch transport, delay local text, or add a text-snapshot stack. Undo/redo
still use the conservative other-replica claim hold from #10133 and emit their
own deltas. Imported work is never made into a local undo obligation.

Navigation, selection, copy, save and refused platform edits close groups. The
GPUI adapter additionally closes retained editor groups on workspace
and tab changes, captured pointer interactions, leader/modal/launcher/terminal
focus and native focus/window deactivation callbacks. These callback paths are
source-built, not observed native behavior under the halt.
Focus loss preserves marked replacement coordinates until the platform commits
or cancels; forgetting them could turn a late commit into a duplicate insertion.

The actual cached dependency is Loro 1.13.6. Its public manual group API is used,
not an inferred transaction timer: [Loro UndoManager API](https://docs.rs/loro/latest/loro/struct.UndoManager.html).
The source API and its internal group/import handling were inspected locally.

## Validation: 2026-09-11

- Eleven new headless regressions cover Unicode/grapheme typing, separate deltas and
  idempotent mirror convergence, timeout/whitespace/paste/newline boundaries,
  selected and multi-grapheme replacement, both deletion directions, slow IME
  updates/final commit, explicit navigation/unmark/save boundaries, real/duplicate
  and dependency-pending imports, undo-then-edit redo invalidation, claims, and a
  delayed IME commit after focus loss without duplicate insertion.
- The full headless target graph passes **895 selected test executions across
  16 targets**, including the late-IME regression and module-rehosting targets.
  The same 13 pre-existing
  real-socket fixtures excluded in [Save evidence](cooperative-editor-save-evidence.md)
  remain excluded after sandbox refusal, not counted as passing.
- GPUI/runtime_shaders source compile passes without app launch. Existing unused
  warnings and unrelated workspace Cargo.lock resolution drift remain; no new
  dependency is introduced and no complete `--locked` result is claimed.
- Independent adversarial review identified missing focus-loss boundaries and
  unsafe composition-range clearing; both were corrected. Native callback delivery still needs
  runtime proof, separate from headless group-closure assertions.
  Final bounded source re-review found no remaining P1/P2.

## Remaining gates

Edit-associated caret/selection restoration is not implemented here; the prior
history path preserves the current selection using CRDT anchors. No native IME,
clipboard, light/dark screenshot, recording, keyboard/zoom/accessibility or human
task result is claimed. The visual merge/release gate remains unmet. There is no
HTML substitute or exemption.

Grouping does not persist private drafts, authorize shared publication, verify a
principal/device, or enable CH3 recovery. No daemon, app, service, provider run,
deployment or stop-marker mutation was performed.
