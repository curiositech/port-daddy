# Harbor Editor / Beat Zed Current State

Refreshed on 2026-08-27 against `origin/main` at `bd77d787b`, live GitHub PR
state, and the current-main #9816 authority-truth successor. The successor is
proposed source, not shipped runtime or a claim about the remote PR's old head.
This is implementation truth, not a competitor pitch. External claims in the
older battle plan remain historical until independently refreshed and cited.

## 1. Capability Matrix

| Area | Landed on main | Remaining |
| --- | --- | --- |
| P0 - editor surface | #563: `SurfaceKind::Editor`, FileTree/open wiring, GPUI and TUI faces. | Complete. |
| P1 - Loro buffer | `HarborBuffer`, stable PD identity -> `PeerId`, authored spans, merge/snapshot/delta primitives, and author gutter. | This branch adds the missing GPUI platform-input/IME bridge, grapheme-safe selection and deletion, caret/selection paint, guarded local replacements, and incremental op broadcast. Undo-map and incremental tree-sitter reparse remain. |
| P2 - multiplayer substrate | #727: edit/presence frames, snapshot/op-log codecs, `/blob`, isolated edit/coordination channels. #729: live producer subscriptions and visible folding. These are checkpoint/reconnect primitives only. | Follow-mode and full two-window/operator proof remain product work. |
| P3 - claims and wedge | #728: claims, conflict prediction, commit gate, and MCP region tools. #729: those signals reach the running editor. | Human claim/release/handoff controls and daemon-side 409 enforcement still need a complete operator proof. |
| P3.5 - editor recovery | Current main has no registered editor-recovery route. | This successor proposes authenticated 503-only route scaffolding. The typed sequence-zero operation-receipt producer, sealed abandonment high-water, canonical Rust Loro validator, and atomic P3 released-claim transfer/provenance transaction are unimplemented required authorities. P2 snapshots, `/blob`, notes, and in-process replay do not satisfy this phase. |
| Code surface | #896: persistent editor state, `CodeBuffer`, syntax runs, `uniform_list` virtualization, headless raster parity. | Incremental tree-sitter reparse and viewport-scoped cache updates remain. |
| P4 / P5 | Capability cards, relay, and harbor primitives exist elsewhere in Port Daddy. | Editor capability dry-run/enforcement, shared-harbor join, and remote-harbor polish are not built. |

## 2. Active Local Text Input Slice

Roadmap receipt: `harbor-editor-local-text-input` (`now`, harbor
`port-daddy`).

The slice deliberately keeps one mutation authority:

1. GPUI's `EntityInputHandler` converts platform UTF-16 composition ranges into
   the renderer-free `EditorInput` model.
2. `EditorInput` keeps caret, selection, and marked text on UTF-8 grapheme
   boundaries and prepares one byte replacement.
3. `EditorPane` checks the existing live-claim guard before mutation, translates
   the byte range to Loro Unicode positions, and emits one authored incremental
   delta.
4. The foreground paints immediately; the producer imports that exact delta
   into its live-lane mirror and broadcasts it. It never independently recreates
   the keystroke.
5. Remote deltas return with collaboration Blocks and are folded into the
   foreground Loro doc before another local edit.

Validation gates:

- insert, replace, backspace, delete, keyboard selection, clipboard, mouse
  placement, UTF-16 IME composition, and grapheme-boundary tests;
- keystroke -> authored Loro delta -> producer mirror -> `CodeBuffer` update;
- unchanged post-edit renders reuse the same tokenized `Arc`;
- GPUI feature build;
- current-branch screenshot and recording showing real typing, caret/selection,
  author gutter, and the virtualized code surface without per-line card chrome.

Honest boundary: edits are live in the collaborative Loro document; writing the
document back to disk, undo/redo, and tree-sitter incremental reparse are separate
follow-up slices.

## 3. Next Landable Slices

### A. Undo Map And Incremental Tree-sitter

- Map local Loro operations into undo groups without undoing remote peers.
- Subscribe syntax parsing to changed ranges, not whole-file re-lexes.
- Preserve idle zero-rerender and virtualized viewport behavior.

### B. Human Claim / Release / Handoff UI

- Turn the current selection into a region claim through the existing session
  file-claim route.
- Show release and handoff/parley actions; never expose a force/bypass action.
- Keep conflict prediction on claim-acquire/region-enter edges, never per key.

### C. Authoritative Editor Recovery And Claim Inheritance

- Kill a real agent with dirty editor ops.
- Produce and seal a daemon-owned, typed, sequence-zero-to-terminal operation
  ledger for the exact abandoned actor and project/harbor/worktree/path scope.
- Have the still-unimplemented canonical Rust Loro authority validate those exact
  operation bytes and terminal state against an advanced document.
- In one transaction, transfer exactly one released P3 claim, consume one
  purpose-scoped token, and persist provenance. Notes may project provenance but
  are never operation evidence; `/blob`, generic salvage, and
  `apply_remote_ops` remain P2 checkpoint/reconnect machinery.

### D. Capability Enforcement Then Shared/Remote Harbor

- Add an in-editor capability dry-run before accepting a write.
- Prove denied regions never create a Loro op.
- Only then build join-by-link, shared-harbor authority, and remote transport
  polish; do not create another sync backend beside the landed tube lanes.

## 4. Non-goals

- No transport-first detour and no new editor backend.
- No broad console topology rewrite hidden inside editor work.
- No full-file save, LSP, or editor-emulation grab bag in the input slice.
- No uncited claims about Zed or another external platform.
