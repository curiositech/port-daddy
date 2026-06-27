# Harbor Editor — P0 Implementation Plan (the walking skeleton)

> Concrete build plan for **P0** of `docs/strategy/harbor-editor-battle-plan.md`.
> P0 is **reuse-only**: an Editor surface that hosts a file with *zero* buffer
> work — no Loro, no networking, no claims. It exists to prove the surface slots
> into the existing `Workspace`/`Pane` machinery and to wire `FileTree → open`,
> so P1 (the Loro buffer — the one genuinely-hard from-scratch cost) has a home.
>
> **Sequencing guard (from `build-coop-ide-gpui`):** the buffer is NOT the
> product. P0→P1 is a buffer; the *wedge* is **P3 — claims + salvage**, and that
> is the first slice anyone demos. We build P0/P1 to set up P3, and we do **not**
> ship a buffer-without-claims as if it were the Harbor. Claims (P3) follow
> immediately; they are not deferred indefinitely.

## What ships in P0

1. **`SurfaceKind::Editor { path, region }`** — a new typed variant beside
   `FileTree` (`core/pd-console/src/mux.rs:41`). `path: String` (file to host),
   `region: Option<(u32, u32)>` (optional 1-based inclusive line span to scroll
   to / highlight — the seam P3 claims paint into). Add arms to:
   - `SurfaceKind::label()` (`mux.rs:59`) → `"edit <basename>"`.
   - the `bind_entity` match (`mux.rs:269`) → rebind `path` like `FileTree`
     rebinds `root`.

2. **`core/pd-console/src/editor_pane.rs`** — `EditorPane`, a **read-only**
   `Pane` (`src/pane.rs:83`). One pane, two faces — it emits render-agnostic
   `Block`s; GPUI paints rich text, the TUI paints the same lines read-only.
   - state: `path: String`, `region: Option<(u32,u32)>`, `lines: Vec<String>`,
     `error: Option<String>`.
   - `refresh()`: read the file **from local disk** (P0 has no buffer/daemon
     fetch). Tokio `fs::read_to_string`; on error store `error` (don't panic).
     Cap very large files (e.g. first N lines + a "… truncated" block) so a huge
     file can't wedge the 2s refresh — the battle-plan's large-file virtualization
     is a P1 concern, P0 just must not hang.
   - `view() -> Vec<Block>`: one block per line with a **line-number gutter**
     (the gutter is where P1's per-PeerID authorship color lands and P3's claim
     band lands — build the column now, monochrome). If `region` is set, mark
     those lines (a tone/marker) so "open at region" is visible. On `error`,
     a single error block.
   - `id()` = `"editor"`, `title()` = `"edit <basename>"`. `mutate`/`subscription`
     keep their trait defaults (read-only in P0).
   - Register `mod editor_pane;` wherever the other panes are declared (main.rs
     or the module root) and export `EditorPane`.

3. **Render dispatch** — find where a non-`Panel` `SurfaceKind` leaf is turned
   into rendered content (the GPUI `app.rs` surface-render match **and** the TUI
   path; mirror how `FileTree`/`Roadmap` are dispatched). Add an `Editor` arm
   that constructs/refreshes an `EditorPane` for `{path, region}` and renders its
   `Block`s. Do not invent a new render pipeline — reuse the Block renderer the
   other surfaces use.

4. **`FileTree → open-in-Editor` wiring** — in the FileTree surface, activating a
   *file* row opens `SurfaceKind::Editor { path, region: None }` via the existing
   surface-open mechanism (`swap_surface`/`split` on the `Workspace` —
   `mux.rs:179/257`). Directories keep their current expand behavior. Add a
   command-line verb too (`:edit <path>` → open Editor) mirroring how
   `surface_for_query` maps strings to `SurfaceKind` (`app.rs` ~107/1362) so the
   surface is reachable without the tree.

## Explicitly NOT in P0 (and which phase owns each)
- Loro / any CRDT, editable buffer, cursor, undo → **P1**.
- Networking / multiplayer / tube sync → **P2**.
- Claims, `/conflicts/predict` bands, agents-as-peers, salvage → **P3 / P3.5**
  (the wedge — the gutter column + `region` seam built in P0 are where these land).
- Harbor card enforcement → **P4**.

## Build gates (the bar for the P0 PR)
- `cd core/pd-console && cargo check --features gpui --bin pd-console` → 0 errors.
- `cargo check` (headless, no gpui) → 0 errors.
- `cargo test` → green (add a unit test for `EditorPane::view()`: a known file
  yields N line-blocks with gutter numbers; an unreadable path yields one error
  block; a `region` marks the right lines).
- **Visual artifact** (the standing Harbor rule): a screenshot of a file open in
  the Editor surface + the FileTree→open interaction, attached to the PR. A
  headless agent cannot produce this — the PR is held for an operator screenshot,
  exactly like the console-writes PR (#540).

## Why P0 is honest, not Potemkin
P0 is a *read-only file viewer*, and it says so. It is not pretending to be a
collaborative editor — it is the surface skeleton the battle-plan's P0 row
specifies ("hosts a file with zero buffer work"), built to slot P1's buffer and
P3's claims into a real home. The Potemkin failure mode is shipping a buffer
without coordination *as the product*; the mitigation is that P3 (claims +
salvage) is the named next wedge, with its seams (gutter column, `region`)
already in place.
