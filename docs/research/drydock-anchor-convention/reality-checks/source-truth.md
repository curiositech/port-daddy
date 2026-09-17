# R1 — Source Reality Check

Status: `SOURCE_PRESENT`

Checked on 2026-09-16 after an explicit `git fetch origin main` in the clean
convention worktree.

| Claim | Live readback | Disposition |
|---|---|---|
| Convention anchor | `6c2c30d74b889b4d8037ce5d43b265bfbf21a686` | Accepted |
| Live `origin/main` | `6c2c30d74b889b4d8037ce5d43b265bfbf21a686` | Accepted |
| Divergence | `0 0` from `git rev-list --left-right --count HEAD...origin/main` | Accepted |
| Worktree branch | `codex/drydock-anchor-convention-20260916` | Accepted |
| Local Port Daddy runtime | Intentionally not invoked | `BLOCKED_BY_HALT` for dynamic claims |

## Static validation receipt

The existing inert validators were run without starting Port Daddy:

| Validator | Result | Bounded meaning |
|---|---|---|
| Drydock skill bundle audit | valid; 24 required files, 17 Markdown files, 48 local links, 20 diagrams | The static bundle is internally present and linked. |
| Resurrection hypertree validator | valid; 12 roles, 30 nodes, 7 hyperedges, 4 launchers; plan digest `sha256:058de383271f41662b6809c4781ae4bf5dd23cf747ce38b70989dcf4f1b0676a` | The example satisfies its structural and semantic static contract. |
| Hypertree execution validator | valid; 1 scoped node, 1 contract, 3 clients, 14 events, 1 rework round; execution digest `sha256:bc1d21bf071cd1be503b615fcfdeb66161f43699802d184667b1c555aeba81b1` | The fixture reduces deterministically to `COMPLETED` and explicitly labels itself `FIXTURE`. |

These checks prove neither execution nor containment. Their most important
truth-preserving behavior is the final fixture label.

## Rejected manager claim

One isolated manager report asserted that canonical `main` was `289b025a0` and
that `drydock-program-architecture` and
`agent-resurrection-and-body-continuity` were absent from canonical skills.
The live fetch and exact tree inspection contradict that assertion. The
convention anchor is current `origin/main`, and both skill directories exist at
the anchor.

The report remains useful as an adversarial example: a persuasive synthesis
can carry an invalid repository witness. The manager is not a source authority.
Source-state claims require a live, exact-root Git readback or remain
`UNKNOWN`.

## What this check does not prove

- It does not prove any Port Daddy, Drydock, VM, provider, broker, or UI runtime
  behavior.
- It does not establish that every external reference in a skill is accurate.
- It does not validate the content of the position papers.
- It does not authorize launching the halted runtime.
