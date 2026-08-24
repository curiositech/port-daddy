# Harbor Editor / Beat Zed Current State

Verified on 2026-08-23 against `origin/main` at `43ca9b49b`, live GitHub PR
state, the roadmap DB, and the active `harbor-editor-local-text-input` branch.
This is implementation truth, not a competitor pitch. External claims in the
older battle plan remain historical until independently refreshed and cited.

## 1. Capability Matrix

| Area | Landed on main | Remaining |
| --- | --- | --- |
| P0 - editor surface | #563: `SurfaceKind::Editor`, FileTree/open wiring, GPUI and TUI faces. | Complete. |
| P1 - Loro buffer | `HarborBuffer`, stable PD identity -> `PeerId`, authored spans, merge/snapshot/delta primitives, and author gutter. | This branch adds the missing GPUI platform-input/IME bridge, grapheme-safe selection and deletion, caret/selection paint, guarded local replacements, and incremental op broadcast. Undo-map and incremental tree-sitter reparse remain. |
| P2 - multiplayer substrate | #727: edit/presence frames, snapshot/op-log codecs, `/blob`, isolated edit/coordination channels. #729: live producer subscriptions and visible folding. | Follow-mode and full two-window/operator proof remain product work. |
| P3 - claims and wedge | #728: claims, conflict prediction, commit gate, and MCP region tools. #729: those signals reach the running editor. | Human claim/release/handoff controls and daemon-side 409 enforcement still need a complete operator proof. |
| P3.5 - salvage | Snapshot/op-log replay primitives and #1539 property-test foundation exist. | The end-to-end kill/recover/inherit-claim demo remains the headline missing wedge. |
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

### C. Salvage Replay And Claim Inheritance

- Kill a real agent with dirty editor ops.
- Consume recovery once, replay onto an advanced document, inherit the region
  claim, and render recovered provenance.
- Persist the snapshot/op-log receipt and immutable note evidence.

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
