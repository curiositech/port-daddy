# Operator Console v11 — the synthesis (spec)

**Status:** Brief (operator-direct, 2026-06-05). Supersedes the standalone mockups
by *combining* them, not replacing — v9 and v10 stay as references.

> Operator's words: *"all the content of v9, with the ghost filetree viz of v10
> and the merge-as-light demo, but the sitrep one sucks. We also need a really
> good text editor that's fast as fuck and a beautiful markdown renderer, using
> the superior IA."*

This is the real operator console. It binds three things that already exist in
pieces — v9's breadth, v10's living heart, and the **voyage IA** — into one surface.

---

## 1. The spine: the voyage IA (locked this session)

Everything hangs off the operator loop and the voyage model:

- **Loop:** Found → **Sight** (`pd periscope`) → Dispatch → Watch → Intervene → Land (+ Remember).
- **Voyage** = the unified noun for *an agent doing a unit of work*. `spawn`,
  `sortie`, `nightshift`, and recurring `fleet` agents are all voyages — they
  differ only on `when (now|queued|scheduled)` × `review (auto|gated)` ×
  `recurring (no|yes)`. (See `docs/design/2026-06-03-ia-refactor-operator-loop.md`.)
- **Status machine** (`lib/session-state.ts`, shipped): lifecycle
  `nascent|open|landed|archived` × cohort-attention `resting|engaged|passed_over|cooling`
  (the fridge model — resting is timerless; the clock starts when you warm a
  harbor sibling; window 45m / pass-over 2h) × health flags
  `behind|conflicted|duplicative[]` × a **breadcrumb** ("what you were doing last time").
- **Destination** of a voyage = a **roadmap item** (intent). A null link is a
  first-class `⚠ untracked` flag. Session status flows *up* into roadmap status.
- All of this is **DB-backed** — no `.portdaddy/current.json`. Attachment is a
  query by worktree.

---

## 2. Keep from v9 (the content)

The view set, re-grouped under the loop (not a flat 13-tab rail):

| v9 view | Lands in loop stage | Notes |
|---|---|---|
| `sphere` (avatar) | conversation spine | the operator-avatar you talk to (ADR-0046) |
| `swarm` (chat multiplex) | Watch | every voyage's chat, multiplexed |
| `cp` (control plane) | Intervene | per-voyage actions: retry · switch backend · pause · kill · reassign |
| `roadmap` ("work pile") | Sight | destinations; voyages link here |
| `res` (spend/counters) | Watch | per-voyage cost, daemon counters |
| `dispatch` | Dispatch | launch a voyage (any verb) |
| `heat` (pheromone tree) | folds INTO the living harbor (§3) | becomes the biofield over the filetree |
| `editor` | Editor (§4) | upgraded — see below |
| `harbor`,`secrets`,`recipes`,`peek`,`covibe` | Found / Remember / Watch | keep as-is, re-pointed |

**Voyage manifest** (built as the v10-language mockup `voyage-manifest.html` this
session) is the Watch/Sight home screen: every voyage, status chip, destination,
**outcome** column, grouped *in-session / fridge / landed*, with HITL gate on top.

---

## 3. Keep from v10 (the living heart) — DROP the sitrep

- **Ghost filetree STAGE** ✅ — stacked parallel-universe worktree planes
  (`.plane.ghost`, `.ghoststem`, `.diverged`). This is the SENSORIUM: each open
  voyage is a ghost plane over `main`; the conversation reconciles against it.
- **merge-as-light** ✅ — landing a voyage eases its ghost plane into `main` on a
  bezier → flash → settle → grow-spine; PR = cobalt cast wrapping the subtree.
  This *is* the "see the outcome" moment, rendered as light.
- **biofield canvas** ✅ — fireflies = live voyages over the filetree (folds in v9's
  `heat`). `prefers-reduced-motion`: canvas loop never starts.
- **`#sitrep` panel** ❌ — **cut it.** The voyage manifest + the living harbor
  already answer "what's happening." The sitrep was a redundant wall of text.

---

## 4. NEW — the two components the operator called for

### 4a. A text editor that is *fast as fuck* — native Rust
- Input latency IS the product. Target sub-frame keystroke→paint (Zed's bar).
- Substrate: a **GPUI rope-buffer editor** (reuse Zed's editor/rope primitives from
  the GPUI ecosystem where possible). NOT a webview editor, NOT Monaco.
- Opens a voyage's working file from its worktree; edits are claim-aware (the
  voyage's session owns the file claims, DB-backed).

### 4b. A *beautiful* markdown renderer — native Rust, GPU text
- Where Port Daddy's docs/blog/ADRs/roadmap/breadcrumbs actually read. Pipeline:
  **`pulldown-cmark` → GPUI text/layout**, real Geist fonts, GPU-rasterized.
- House rules enforced: **≥14px body** (no tiny fonts), Tufte sidenotes in the right
  gutter, rendered Mermaid, syntax-highlit code (`syntect`), the v10 palette.
- Editor (4a) + renderer (4b) side-by-side: edit left, beautiful render right —
  both GPUI, both in-process, both Warp-fast.

---

## 5. Platform — LOCKED: native Rust, GPU-accelerated (Warp/Zed-class)

**Operator decision, 2026-06-05: "I want it in Rust. RUST. Fast AF like Warp."**

This closes Gate 0 and rules out two earlier candidates:
- ❌ **Tauri/webview** — not Rust-native, not Warp-fast.
- ❌ **classic ratatui** (terminal cells) — can't render the smooth merge-as-light
  bezier, GPU text, real fonts, or a Zed-class editor. Terminal-grid is the
  fallback, not the product.

✅ **Native Rust, GPU-rendered.** Like Warp (Rust + custom GPU UI) and Zed (Rust +
GPUI). The whole console — living harbor, fast editor, beautiful markdown — is one
GPU-accelerated Rust app.

**Substrate recommendation: GPUI** (Zed's now-open Rust GPU framework).
- It is literally the engine behind the fastest editor in existence — "fast as
  fuck" is its design center (sub-frame input→paint, GPU-rasterized text).
- One framework covers all three asks: the rope-buffer editor (4a), GPU-rendered
  beautiful markdown (4b), and the living-harbor canvas (ghost filetree +
  merge-as-light, §3) as GPU primitives.
- Alternatives: raw **wgpu** (max control, much more work) or **egui** (fastest to
  stand up, immediate-mode, but harder to make *beautiful*). GPUI is the fit.

**Crate:** `core/pd-tui` (ADR-0046 codename) becomes a real Rust crate in the
existing workspace (alongside `core/pd-bosun`, `core/harbor-card-rs`). It is a GPUI
**app**, not a terminal program. Daemon access via `reqwest`/`hyper` over the Unix
socket (`~/.port-daddy/daemon.ipc`) or TCP from the port file — reusing the
canonical discovery rule (one client, see the daemon-client consolidation, PR #261).

A thin terminal `pd tui` (voyage manifest as text, no viz) may still exist as the
SSH-able fallback — but it is NOT the console. The console is the GPU Rust app.

> Honest scope: Warp and Zed are funded teams. A GPU-native Rust operator console
> with a Zed-class editor + a gorgeous markdown renderer + a live harbor viz is a
> real product, not a weekend. Sequence it (§6); the **Rust voyage-manifest pane
> over live daemon data is the tractable first proof** that the substrate sings.

---

## 6. Build order (Rust/GPUI — so it doesn't strand)

0. **Scaffold `core/pd-tui`** — new GPUI crate in the existing Rust workspace; a
   window that opens, the v10 palette/Geist loaded, one frame painted. Proves the
   substrate + toolchain.
1. **Daemon client** — `reqwest`/`hyper` over the Unix socket / TCP port file
   (canonical discovery). Typed voyage/session DTOs (mirror `session-state.ts`).
2. **`pd voyages` manifest pane** — the spine, over LIVE daemon data. This is the
   first thing that must feel Warp-fast and look like the v10 mockup.
3. **Living harbor STAGE** — ghost filetree + merge-as-light as GPUI primitives,
   fed by real worktree/PR state.
4. **Editor + markdown renderer** — the side-by-side (4a/4b).
5. **Fold in v9 views** under the loop; **cut the sitrep.**
6. **ADR-0049** — ratify "operator console = native Rust/GPUI" once step 2 proves it.

Each step ships and is verified by a real screen capture of the running Rust app.
No big-bang. Step 0–2 are the proof; everything else compounds on a fast spine.

---

## 7. Design system (locked 2026-06-05)

Direction: **Editorial** — one sans, high contrast, one accent, no rainbow chips.
Operator rejected the earlier 3-font / low-contrast / "clowny" pass; this is the fix.

**Type** (both libre):
- **General Sans** (Fontshare) — UI, manifest, headings, prose. Humanist-geometric;
  characterful without being clowny. Honors the ≥14px floor.
- **IBM Plex Mono** — code, diffs, the editor buffer, tabular voyage data.
- (No third font. Serif considered — Sentient — but rejected for restraint.)

**Palette** (warm-dark; light variant derives by inversion, both required):
```
--bg     #0e0d0b   (warm near-black)      --panel #16140f
--ink    #f3eee3   (HIGH-contrast body)   --ink2  #d4ccbb   --muted #a89e88 (floor for real text)
--line   rgba(241,236,225,.14)            --line2 rgba(241,236,225,.30)
--accent #e0b15c   (one amber accent — the ONLY brand color used decoratively)
```
**Status** = monochrome chips + one semantic dot, never a rainbow:
`engaged` amber dot · `gated` rose `#d98a82` · `resting` slate `#6c6557` · `landed` green `#86c98e` ·
`conflicted` rose. Color carries *only* meaning, never decoration.

**Rules carried in:** contrast is the #1 complaint — verify both themes; never tiny
fonts; one accent; status by meaning. (These become the GPUI theme constants in
`core/pd-console`, mirrored in the ratatui fallback where the terminal allows.)
