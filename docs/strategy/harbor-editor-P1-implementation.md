# Harbor Editor — P1 Implementation (the Loro CRDT substrate)

> Concrete record of **P1's foundation slice** from
> `docs/strategy/harbor-editor-battle-plan.md` (§3 architecture, §5 the P1 row
> "Buffer + Loro", §7 weeks 1–2). P0 shipped the read-only Editor *surface*
> (`SurfaceKind::Editor`, `EditorPane`, the gutter + `region` seam — see
> `harbor-editor-P0-implementation.md`). P1's foundation backs that surface with a
> **real Loro CRDT buffer** and proves the co-equal-replica model that is the whole
> point of the wedge.
>
> **This records the original substrate slice, not current editor truth.** The
> later `harbor-editor-local-text-input` slice supplies the platform input bridge;
> the historical boundary below remains useful provenance.

## What shipped in this slice

1. **`loro` v1.13.x dependency** (`core/pd-console/Cargo.toml`, resolved to
   1.13.6). It is a plain dependency, **not** behind the `gpui` feature — the
   buffer is renderer-agnostic and compiles + unit-tests on Linux with the default
   feature set, so the co-equal-replica proof runs in the headless CI gate. Builds
   clean on both `cargo check` and `cargo check --features gpui --bin pd-console`.

2. **`core/pd-console/src/buffer.rs` — `HarborBuffer`.** A renderer-agnostic,
   unit-testable wrapper over a `LoroDoc` + a `LoroText`:
   - `open(path, identity) -> Result<HarborBuffer, io::Error>` — loads the file's
     bytes into the `LoroText` as initial content, authored to a replica whose
     **PeerID is minted from the operator's PD identity**.
   - `empty(identity)` — an empty buffer for a given identity (used to spin up a
     second "agent" replica in the merge proof).
   - `export_ops()` / `apply_remote_ops(bytes)` — Loro `export(ExportMode::all_updates())`
     / `import`, so a SECOND replica's ops merge in. This is the M×N proof plumbing.
   - `insert_authored(pos, s)` / `append_line(line)` — programmatic authored edits
     (NOT live keystrokes — see below). Each insert marks its span with the
     author's PeerID.
   - `lines() -> Vec<LineView>` where `LineView { text, author_peer: Option<PeerId> }`
     — per-line authorship derived from Loro richtext marks.

3. **PeerID ↔ PD identity mapping (documented).** A Loro `PeerID` is a `u64`.
   `peer_id_for_identity(&str) -> PeerId` hashes the PD identity string
   (`project:stack:context` for an agent, the OS user / `pd whoami` for a human)
   with **FNV-1a**, masking off the single `u64::MAX` value Loro reserves. The
   mapping is **deterministic and stable across process restarts** — so a
   reconnecting actor lands on the *same* replica id and authorship remains stable.
   This identity primitive is necessary but not sufficient for P3.5 recovery; a
   successor cannot self-assert a dead actor's identity. The console
   call site passes the operator's real identity; the buffer itself accepts the
   **injected identity string** so it stays free of any daemon dependency and
   testable headless.

4. **The 2-replica merge test** (`buffer::tests::two_replicas_merge_with_correct_authorship`).
   Replica A (operator) opens a file; replica B (an "agent" peer) imports A's
   state, inserts a line, exports its ops; A imports B's ops; the test asserts A's
   `lines()` shows **both** contributions, each attributed to the correct replica,
   and that both replicas converge to identical byte content. **This is the P1
   deliverable — the co-equal-replica substrate, demonstrated.** Supporting tests:
   stable/identity-specific PeerID, opener-attributed seed lines, and idempotent
   re-import (a P1/P2 merge and reconnect property, not recovery authority).

5. **`EditorPane` renders from the buffer** (`core/pd-console/src/editor_pane.rs`).
   It no longer reads raw bytes with `std::fs::read_to_string`; it holds a
   `HarborBuffer` and renders `buffer.lines()`. Each line keeps the line-number
   gutter AND gains a **per-PeerID authorship marker**: a short, stable author tag
   in the gutter, plus authorship legend `Flag`s. Still **read-only on screen**.
   The `region` seam is preserved (region lines keep the `▍` marker).

## Authorship attribution — the approach and its honest limits

**Mechanism.** Authorship lives in **Loro richtext marks**. Every authored insert
marks its span with the inserting replica's PeerID under an `author` style
(registered with `ExpandType::None` so a neighbouring line's author is never
silently inherited at a boundary). `LoroText::get_richtext_value()` returns the
text as a list of spans, each carrying its `author` attribute, and these marks
**merge deterministically across replicas** (verified in the merge test — the
agent's span keeps its own author after merging into the operator's doc). `lines()`
walks those spans, accumulates characters into lines, and attributes each line to
the author of the span that contributes its **first character**.

**The approximation (sanctioned by the battle-plan).** Attribution is **per-line,
by leading character**, not per-character. If a single line is straddled by two
spans with different authors (e.g. replica B inserts mid-line into a line replica A
wrote), the whole line is attributed to the author of its leading character. The
battle-plan §5 P1 row explicitly permits per-line attribution over heavy
per-character attribution ("if per-char author is heavy, attribute per-line by the
last op's peer — document the approximation honestly"). Line-granular authorship is
the correct grain for the gutter marker anyway. **This is a display-granularity
choice, not a correctness gap** — the underlying Loro marks are per-span and exact;
only the gutter rendering rolls them up to per-line. Per-character authorship
(splitting a line's gutter cell by sub-spans) is a later refinement.

**Gutter → Tone mapping (documented + unit-tested).** `author_tone(author, opener)`
maps the **opener replica (the operator who opened the file) → `Resting`** and **any
other replica (an agent whose ops merged in) → `Engaged`** (`Default` for unmarked
content). The GPUI face applies this Tone to the gutter cell; the TUI face shows the
author-tag text — both paint the same `Block`s. Color is meaning (semantic `Tone`,
resolved to theme OKLCH by the renderer); there is **no `rgb(0x…)` hex** anywhere.

## Foundation-slice boundary (historical)

- **At the time this foundation landed, there was no live keystroke editing.**
  The later `harbor-editor-local-text-input` slice adds `editor_input.rs`, GPUI's
  platform `EntityInputHandler`, IME/selection/grapheme handling, guarded Loro
  replacements, caret paint, and incremental delta broadcast.
- **No undo-map, no tree-sitter incremental reparse.** Named in the battle-plan's
  full P1 row; out of scope for this foundation slice (the full P1 is multi-week).
- **No networking / multiplayer / tube sync** — that's P2. `export_ops`/
  `apply_remote_ops` exist and are proven in-process (the merge test), but no
  transport wires them across processes yet. These methods import Loro updates;
  they do not verify abandonment, prove a complete sequence-zero ledger, authorize
  another actor, transfer a claim, consume a recovery token, or persist provenance.

## The named continuation

1. **Undo-map + tree-sitter incremental reparse.** These remain the unfinished
   P1 items after local input. Local undo must not undo remote peers, and syntax
   work must consume changed ranges instead of re-lexing the full file.
2. **P3 — claims (the actual wedge).** `POST /conflicts/predict`, claim-before-edit,
   region/symbol claims rendered as Loro awareness ranges, the `Conflicted` guard
   band on overlap, and the agents-as-peers demo. The battle-plan is explicit: a
   buffer without claims and authoritative recovery is a Potemkin editor, not the
   product. The gutter
   column and `region` seam built in P0/P1 are exactly where the claim bands land.
   **P3 follows the live-edit Element; it is the first slice anyone demos and must
   not be deferred indefinitely.**

## Build gates (all passed)

- `cargo check` (headless, no gpui) → 0 errors.
- `cargo check --features gpui --bin pd-console` → 0 errors.
- `cargo test` → green, incl. the 2-replica merge test and the `EditorPane`
  authorship-gutter test (`authorship_gutter_distinguishes_operator_and_agent_lines`).
- `verify_console.py run --crate core/pd-console` → `ok:true`.
- `grep 'rgb(0x'` over the new code → 0 code hits (the only match is a doc comment
  asserting the no-hex rule).
- `cargo test --features gpui` may SIGBUS linking the gpui test harness — a known
  env issue; the headless tests + the gpui `cargo check` are the relied-upon gates.
