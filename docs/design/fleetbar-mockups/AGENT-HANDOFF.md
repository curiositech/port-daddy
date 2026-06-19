# Agent Handoff — TUI FleetBar Track

You are taking over the **TUI FleetBar** design exploration and driving it toward
a ship/no-ship decision and (if ship) an implementation. This is a self-contained
track; another agent owns the daemon's `pd attest` work in parallel — **do not
touch `lib/`, `routes/`, `server.ts`, or `cli/` except the `pd-tui` crate and
design files.**

## What exists (your inputs)

Branch: **`design/tui-fleetbar-mockups`** (off `origin/main`). Everything is here:

- `docs/design/fleetbar-mockups/` — 13 HTML mockups. Start with `research-report.html`
  (rationale), `iteration-synthesis.html` (the 3-round / 15-persona study),
  `v4-mockup.html` (latest full iteration), `gallery.html` (index).
- `docs/design/tui-mocks.QC.md` — two formal blind-test QC rounds (44/50 → 48/50)
  with the punch-list and accessibility criteria the design must keep meeting.
- `core/pd-tui/` — Rust TUI prototype (`src/tokens.rs`, `src/bin/vibe.rs`, a
  327-line neobrutalist demo). This is the real artifact to evolve.
- `design/tokens/` + `docs/design/tokens.aaa.css` + `docs/design/fonts/` — the
  shared design tokens (synced across HTML / Rust / Swift) and font stack.

Provenance: originally Codex branch `codex/tui-fleetbar-design-wip-20260518`
(commit `b37db89e`, 2026-05-18). Design research — never shipped.

## Hard constraints (non-negotiable — from the operator)

1. **Accessibility floor: 14px minimum** on prose/body/caption. 12px only for
   uppercase, weight ≥600, letter-spacing ≥0.1em eyebrows. Never lock zoom. The
   TUI equivalent: do NOT pre-render at the smallest readable terminal grid — let
   the terminal scale; verify legibility at default and large terminal font sizes.
   The QC rounds already enforced contrast (WCAG AA); keep that bar.
2. **No emojis as UI icons.** Maritime/neobrutalist glyph vocabulary only (the
   mockups use Braille DAG edges, flag glyphs as agent avatars, octant micro-pixels).
3. **Maritime design DNA** stays — read `docs/adr/0010-maritime-design-language.md`.
4. **Honest, not Potemkin.** No buttons that do nothing. If the TUI shows fleet
   state, it must read real daemon state (`GET /spawn`, `/health`, `/roadmap/items`,
   `/msg/:channel`), not mock data. Transparently hollow is fine; fake-working is not.
5. **Scratch only under `~/coding/tmp/`, never `/tmp`.** Worktrees too.
6. Coordinate via Port Daddy: `pd begin --identity port-daddy:tui:fleetbar --lifecycle durable`,
   claim `core/pd-tui/**` + `docs/design/**`, leave notes. Don't claim daemon files.

## Your deliverables (in order)

1. **Decision doc → ADR.** Review the mockups + QC, then write `docs/adr/0046-tui-fleetbar.md`
   using the **Implementation Matrix** format (see `docs/adr/0043-...md` and the
   README template). Each phase = a `roadmap_items` row; create them via
   `POST localhost:9876/roadmap/items` at `status: now` (see how ADR-0043/0044/0045
   phases were seeded). Recommend ship / no-ship / hybrid with rationale.
2. **If ship:** evolve `core/pd-tui` from demo to a real `pd tui` (or `pd watch`-style)
   binary that renders live fleet state. Wire it as a CLI surface; respect parity
   (`features.manifest.json`) and completions if you add a verb.
3. **Keep the QC discipline:** re-run a blind-test pass (personas in
   `iteration-synthesis.html`) on any new screen; update `tui-mocks.QC.md`.
4. PR per the repo flow (worktree → begin → claim → guard → commit → push →
   `gh pr create`). Verify the Rust crate builds (`cargo build` in `core/pd-tui`).

## Launch command (operator runs this)

```bash
# from /Users/erichowens/coding/port-daddy
pd spawn --backend claude-cli \
  --identity port-daddy:tui:fleetbar \
  --purpose "Drive TUI FleetBar to ship/no-ship + ADR-0046 + pd-tui implementation" \
  --task "Read docs/design/fleetbar-mockups/AGENT-HANDOFF.md on branch design/tui-fleetbar-mockups and execute it end to end."
```

(Or paste this file's contents as the task to any Codex/Claude session checked out
on `design/tui-fleetbar-mockups`.)
