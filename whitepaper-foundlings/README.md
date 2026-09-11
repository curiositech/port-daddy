# Whitepaper foundlings

Figures and research documents pulled from stranded branches, for visual/editorial
review before any branch deletion. See `docs/harbor-research/exposition/BRANCH-HARVEST.md`
for the full harvest report this folder implements.

## Figures

88 `.tex` figure files whose *filename* does not already exist under
`whitepaper/figures/` or `website-v2/public/whitepaper/figures/` on `main`, pulled
from a single branch (`worktree-convoy-platform-requirements`) that turned out to
carry the fullest copy of every branch's figure set. Two distinct figure eras are
mixed here:

- **68 modern figures** (`fig-he-*`, `fig-swk-*`, `fig-stp-*`, `legible-swarm-*`,
  `fig-bonded-*`, `fig-fh-*`, `diag-*`, `fig-auction-inline.tex`) — these use the
  Book's current figure language. **27 of them compile cleanly** under the live
  Book preamble → `foundlings-book-style.pdf`. Many are figures the author's own
  Wave 11 editorial pass already deliberately cut from the book (turned into
  tables, e.g. every `fig-stp-*` here) — check `BRANCH-HARVEST.md` §5 before
  treating an absence from `main` as an oversight rather than a decision.
  4 files (`diag-auction-mechanisms.tex`, `diag-cartel-game.tex`,
  `diag-cuckoo-filter.tex`, `diag-delegation-chain.tex`) carry their own
  `\documentclass` and are complete standalone documents; not in either PDF below,
  open them directly.
  The remaining 37 book-language figures failed to compile under the Book preamble
  and were not further debugged (see `screen/*.compilelog` under the harvest
  build for the exact error per file, not carried into this commit).

- **20 legacy figures** (`docs/harbor-research/figures/fig-r*.tex`,
  `fig-paper*.tex`, `fig-a7-floor.tex`, `fig-b1/b2/b6-*.tex`, `fig-rdf-relation.tex`)
  — these predate the Book entirely and use their own, much simpler research
  preamble (`docs/harbor-research/tex/preamble.tex`, also pulled in here for
  reference under `_research-preamble/`). Screened individually; the passing
  ones are combined into `foundlings-research-style.pdf`, the rest listed in
  `research-screen-results.tsv`.

Two rendered PDFs, plus a third for the wave-11 skill's proposed figure language
(see `skill_candidates/`):

- `foundlings-book-style.pdf` — 27 figures, current Book preamble.
- `foundlings-research-style.pdf` — the passing legacy `docs/harbor-research`
  figures, their own preamble.
- `skill_candidates/skills/tikz-diagram-craft/` (see that folder's own PDF) — the
  wave-11 skill's example redraws and templates, all 13 rendering cleanly under
  its *proposed* v2 figure language, not the Book's current one.

## Research documents (not figures)

Each subfolder is named for its source branch and holds files confirmed absent
from current `main` (spot-checked individually, not assumed from the original
branch-scan report):

| Folder | What it is |
|---|---|
| `papers-overhaul/` | `INVENTORY.md` (26+ cross-cutting cohesion defects across the original 7 papers) + `PLAN.md` (a "Harbor Edifice" restructuring plan) |
| `cartographer-and-spider/` | a dated roadmap-health snapshot + a systems-thinking note on 3 concrete feature combinations |
| `pd-humanize-red-to-green/` | a PR body + 3 Playwright scripts driving a mock agent through a red-to-green test-failure demo |
| `adr-0060-forensics-journal/` | ADR for an append-only, fsync'd security-violation journal independent of the 7-day activity-log prune |
| `convoy-platform-requirements/` | the RFC from Port Daddy's first real external consumer (expungement.guide) |
| `empirical-closure-and-voice-rules/` | 3 research memos (circuit breakers, a SMART feature roadmap, a critical-path plan) plus a self-contained voice-enforcement CI gate design (`.voice-rules.yml` + checker + workflow + test) — **not wired into this repo's CI**, none of these four files are under a path this repo's workflows or jest config scan; it's a working reference bundle to evaluate, not an active gate |
| `redteam-dialogue-v25-v26/` | a structured 5-finding red-team review of the whitepaper draft (severity-scored, some findings may still be live) |
| `figaudit-and-audit-screenshots/` | 405 rendered-page screenshots from two prior figure-review passes (not authored research — a visual cache, kept for before/after reference) |

`docs/harbor-research/exposition/literature/` (the outside literature reviews),
`docs/design/pheromone-vocabulary-v1.md`, `docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`,
and `.scratch/{agent-coordination,multiplayer-input,pheromone-visualization,note-abstraction-audit}research.md`
were all found **already on `main`** — not copied here, no action needed.
`docs/research/2026-06-03-hive-mind-realism-check.md` is likewise already on main.

`apps/relay/` and its ProVerif proof (`analyses/relay_e2e_secrecy.pv`) and ADR
(`docs/adr/0027-relay-harbor-mesh.md`) are also already on `main`, fully — the
`worktree-relay-v0-build` branch is entirely superseded, nothing pulled from it.

The soma / retired-orchestration-tool source audit named in `BRANCH-HARVEST.md` §1.2 was
**not** pulled in here, even though it was on the original list: its entire subject is a
retired tool this repo's `jury-rig-custodian-contract` test bans by name in both tracked
paths and text, with no exemption mechanism, and the audit can't be reworded around that
without erasing what it actually audits. See `BRANCH-HARVEST.md` §1.2 for where to find the
original file if it's wanted directly.
