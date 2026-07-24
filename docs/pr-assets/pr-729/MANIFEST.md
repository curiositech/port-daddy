# Visual Proof — PR #729 (`harbor-editor/wire-wedge-live`)

Provenance manifest for the Harbor Editor **wedge** artifacts, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose.** Each artifact's `commit` field is
> `6055405ac` — the **code under review** whose wedge these pixels depict (PR #729
> HEAD at capture time, after the branch merged `origin/main` in `cd8f9c53b`).
> The image/webm bytes are hosted in a follow-up commit that ONLY refreshes
> `docs/pr-assets/pr-729/` (the wedge surface is byte-identical at both), so the
> raw URLs pin to that asset commit — the commit where the file bytes actually
> exist.
>
> **Re-capture note (2026-07-09).** Re-recorded at `6055405ac` because the
> un-rot merge (`cd8f9c53b`) folded in main's #896 virtualized Harbor-editor
> rewrite — the original captures at `8a0f4ead9` depicted the superseded
> per-line paint path. Same harness, same tape, same agent-safe repl
> second-face; the render path under it changed (per-line `Row` cards → one
> virtualized `CodeBuffer` block with highlight bands painting BEHIND the code).

## What these artifacts show

The in-editor wedge (P2 presence + P3 region-claim bands / conflict guard)
**painting** through the post-#896 render path — the same `EditorPane::view()`
`Block` sequence the live app surfaces, turned into **actual rendered pixels**:

- an **amber `Tone::Conflicted` predicted-conflict band** naming the contended
  symbol: `△ predicted conflict — 'parse_header' (L10–L20): 1 blocking`, plus the
  pd-nudge (`the daemon predicts 1 blocking conflict(s) … request a handoff…`);
- a **red `Tone::Gated` contender chip** `✗ 'parse_header' is claimed by peer 7e`
  with its refusal line (`region 'parse_header' is held by peer 7e's live claim …`);
- the **blue remote presence cursor** `⚑C peer 07 · caret L5 · view L1–L25`;
- the **live region-claim flags** `⚑R you — parse_header · L10–L20` and
  `⚑R peer 7e — parse_header · L10–L20`;
- the ordering invariant: **every conflict signal renders ABOVE** the file
  content;
- the **`CodeBuffer` block** (new in #896): the file as one tight virtualized
  surface with gutter numbers, per-line authorship tags (`e5`), and the
  claim/conflict **highlight bands painted behind L10–L20**.

Block census emitted by the render (harness stderr, machine-checkable):
`Conflicted bands=2  Gated chips=1  awareness flags=4  total blocks=10`.
(The pre-merge census read `… Gated chips=2 … total blocks=35`: #896 collapsed
the per-line Rows into one `CodeBuffer` block, and the commit-gate verdict chip
moved out of the unstaged-view path.)

## HONEST caveat — which "face" this is (read before trusting the label)

This is the **repl / TUI "second face"** of the console — **NOT the gpui
window**. The console is a "one pane, two faces" design (PR #729 body): the gpui
window and this headless painter (`core/pd-console/src/term.rs::render_blocks`)
emit the **same `pane::Block`s**. This capture drives the real `EditorPane::view()`
Blocks through the real repl painter, so the pixels are a faithful render of the
same Block tree the gpui face paints — but they are the terminal face, not the
Metal/`NSWindow` face.

**Why not the gpui window itself:** per
`core/pd-console/docs/recording-visual-artifacts.md` (shipped by the offscreen
harness PRs #577/#595), the **gpui element tree cannot render windowless** —
there is no headless/Method-A path for the shell, only for the Vello/wgpu proto
surfaces. The windowed capture paths (`core/pd-console/scripts/capture-gpui.sh`,
`core/pd-console/scripts/proof/capture-proof.sh`) need macOS Screen-Recording (TCC) permission,
which a headless agent shell is denied (`could not create image from display`).
So the gpui window is genuinely not screenshot-capturable in this environment —
the PR's `visual-exempt` note is correct about that. These artifacts do NOT
claim to be the gpui window; they prove the wedge Blocks paint, on the CI-testable
face, at this commit.

## Reproduce

```bash
git checkout 6055405ac
cd core/pd-console
cargo run -q --example wedge_render_proof     # no `gpui` feature; prints the surface
# PNG + webm were captured by driving that command under vhs, from the repo root:
vhs docs/pr-assets/pr-729/proof.tape
```

`examples/wedge_render_proof.rs` seeds the wedge with the **same producer folds**
(`ingest_claim` → actor B's claim, `ingest_presence` → actor C's presence — the
exact inherent methods main.rs's live drain calls — then local acquire → wedge
probe → `apply_conflict_report` with a BLOCKING prediction), and paints
`pane.view()` via `render_blocks`. State is seeded **in-process** — no daemon,
no network — hence `sourceLabel: fixture`.

---

## Artifact 1 — `wedge-editor-face.png` (still)

- File: `docs/pr-assets/pr-729/wedge-editor-face.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/9d37e7048ae5d5cb2d431af7ea1680391bebcde9/docs/pr-assets/pr-729/wedge-editor-face.png`
- Daemon port: `none` — in-process fixture seed; the harness starts no daemon and opens no socket
- Run id: `n/a (fixture)` — no live agent run; state seeded deterministically by `examples/wedge_render_proof.rs`
- Transcript head hash: `n/a (fixture)` — no transcript; the seed is a fixed in-process sequence, not an event stream
- Agent node id: `n/a (fixture)` — seeded identities are fixtures: local `port-daddy:editor:agent-local` (peer e5), remote `port-daddy:console:human-B` (peer 7e), remote `port-daddy:editor:agent-C` (peer 07)
- Commit: `6055405ac3f91c2c15a1595bda897fa37355c82a`  (PR #729 HEAD at capture time, post-merge)
- Source: `fixture`  — repl "second face", not the gpui window; state canned in-process, declared honestly

## Artifact 2 — `wedge-editor-face.webm` (motion — the harness painting the surface)

- File: `docs/pr-assets/pr-729/wedge-editor-face.webm`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/9d37e7048ae5d5cb2d431af7ea1680391bebcde9/docs/pr-assets/pr-729/wedge-editor-face.webm`
- Daemon port: `none` — in-process fixture seed; no daemon
- Run id: `n/a (fixture)` — no live run; deterministic in-process seed
- Transcript head hash: `n/a (fixture)` — no transcript event stream
- Agent node id: `n/a (fixture)` — seeded fixtures: agent-local (e5), human-B (7e), agent-C (07)
- Commit: `6055405ac3f91c2c15a1595bda897fa37355c82a`  (PR #729 HEAD at capture time, post-merge)
- Source: `fixture`  — repl "second face" (vhs capture of a real terminal running the harness), declared

## Artifact 3 — `wedge-editor-face.ansi` (raw rendered bytes)

- File: `docs/pr-assets/pr-729/wedge-editor-face.ansi` — the exact truecolor ANSI the PNG/webm render (`cat` it in a terminal). Bonus grep-able proof.
- Daemon port: `none` · Run id: `n/a (fixture)` · Transcript head hash: `n/a (fixture)` · Agent node id: `n/a (fixture)`
- Commit: `6055405ac3f91c2c15a1595bda897fa37355c82a`
- Source: `fixture`

## Capture technique

vhs (`/opt/homebrew/bin/vhs` v0.11.0) recording a real `bash` PTY that runs the
committed harness binary; PNG via vhs `Screenshot`, webm via vhs `Output` (VP9,
1520×1560). No `screencapture`/TCC involved. Truecolor forced in-harness
(`TermStyle::with_mode(ColorMode::Truecolor, …)`) so band tones render regardless
of stdout tty detection.
