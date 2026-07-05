# Legible Roadmap With Sidequests

Steward one canonical product roadmap while honoring energy-driven
sidequests — without either killing ADHD momentum or letting work become
invisible.

Use this skill when you need to design a link-or-opt-out discipline for
planned and sidequest work alike, run a periodic reconciliation that folds
burst-energy work back into the roadmap, or diagnose why a roadmap has
degraded into either a rigid planning cage or an ignored wishlist.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/roadmap-legibility-mechanics.md` for the link-or-opt-out
   mechanic and how it maps onto the real `roadmap-link` CI gate.
3. Load `references/sidequest-reconciliation-playbook.md` for the
   start/spawn-capture/reconciliation gate ladder that protects momentum.
4. Fill `templates/output-template.md` for the window you're reconciling, or
   write a state matching `schemas/roadmap-state.schema.json` directly.
5. Run `node scripts/roadmap_legibility.mjs --input state.json`.

A window that scores `pass: true` means every work unit — planned or
sidequest — is traceable to a roadmap item or an explicit opt-out, every
spawned follow-on was captured, every non-trivial status claim is
evidence-backed, and reconciliation is happening often enough to matter. If
it doesn't, fix the work units' records, not the audit's judgment.
