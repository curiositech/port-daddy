# Branch harvest: stranded treasure across 139 worktree/feature branches

Written 2026-09-08 by a textbook-companion session, at the author's request, before any
branch deletion. Method: 898 remote branches surveyed by prefix; 139 selected as the
"treasure bucket" (`worktree-*`, `recover/*`, `design/*`, `paper(s)/*`, `research/*`,
`figs/*`, `proto/*`, `salvage/*`, unmerged `wave-11/14/16/*`, `skill/*`, `documentarian/*`).
The other ~760 branches (`codex/*`, `feat/*`, `purser/*`, `fix/*`, `dispatch/*`, `fleet/*`,
etc.) were explicitly out of scope this round — routine bot/PR branches, not scanned in
depth. Each of the 139 was read by two independent Haiku agents (`git fetch --depth=1`,
`git diff --name-status` against `origin/main`, `git show` on anything interesting) so
disagreements between the two passes could be caught rather than trusted blind. All 139
branches were covered; nothing in the bucket was skipped.

**Read this critically.** Two things the pairing already caught: (1) a Haiku agent flagged
`whitepaper/single-writer-kernel.tex`, `whitepaper/legible-swarm.tex`, and
`website-v2/public/whitepaper/harbor-economy.tex` as "treasure, not in main" — those are
literally the current book's live chapter sources; its partner correctly called them
superseded. (2) a claim that `research/evolutionary-agent-coordination-sandbox` holds 205
unmerged files including a TLA+/Z3 proof suite, a GitHub App, and a CLI dispatch system —
several of the specific paths named (`.github/workflows/proofs.yml`, `sweep-delta.sh`, the
δ-threshold Z3 proof) are already-landed per `TEXTBOOK-BUILD-LEDGER.md`'s P1/F1/F2/round-5
rows. Treat any single-agent "not in main" claim below as a lead to verify with a real diff,
not a fact — I have not personally re-verified every line below; I've flagged the ones I
could cross-check against what I'd already read this session and the ones that contradict
each other.

## 1. High-confidence treasure (worth a deliberate salvage decision)

### 1.1 Directly relevant to the live textbook PR (#10064) — look at these first

| Branch | What's there | Note |
|---|---|---|
| `wave-11/tikz-craft-skill` | a fully worked alternate figure-language library (9 concept-hue color system, typography ladder, 1:1.8:3.2 stroke-weight ratio, arrow scaling rules, with rationale comments) plus 7 working TikZ templates (block-stack, quadrant, grid-matrix, nested-sets, sequence, state-machine, tree-dag) and a palette checker/renderer script pair — pulled into this PR at `skill_candidates/skills/tikz-diagram-craft/templates/pd-figure-language-v2.tex` and `skill_candidates/skills/tikz-diagram-craft/scripts/palette_check.py`. | Both independent agents confirm in detail. Worth comparing against the current `pd-figure-language.tex` on main — this may be a superseded draft or may contain ideas (the hue-per-concept mapping, the stroke-weight ratio) not yet in main's version. |
| `wave-14/substrate-harness` | `studies/substrate-study/` — a **pre-registered empirical study** (`PROTOCOL.md`, `PILOT.md`, `CHANGELOG.md`, `corpora.json`) comparing single-writer-rail vs. worktree-per-agent collaboration models across 6-7 git substrates, with a standalone Python harness (`corpus.py`, `agents.py`, `sim.py`, `metrics.py`) splittable via `git subtree`. 80/84 pilot cells already run with real throughput/wasted-work/conflict data. | This is a real, run experiment with results, not a proposal. If genuinely never folded into the book, this is exactly the kind of "empirical hypothesis" claim the book's page grammar has a slot for. |
| `wave-16/credit-the-canon` (= `research/literature-review`, same content, confirmed by 3 independent reads; **since merged to main**, see `docs/harbor-research/exposition/literature/README.md` and its four `part-*.md` siblings) | a genuine literature review of all 4 parts / 48-50 ideas, each marked `[verified]`/`[as-cited]`/`[unverified]`, naming undercited prior work (Sheridan/Parasuraman automation-levels, SPKI/SDSI, Kofman–Lawarrée on auditor collusion, ActivityPub/Matrix for federation, ~2-3 more per part) and known results restated under private names (Schmeidler–Yaari comonotonicity, Spence signalling, Kreps–Wilson). | This is a finished, citable deliverable, not a sketch. Bears directly on the book's citation completeness — worth a real look regardless of the other open decisions. |
| `wave-16/swiss-plates` | `scripts/whitepaper-plates/swiss_prompts.py` — the actual Swiss-edition plate palette (paper #FBF7EF, ink #121212, 4 part hues at 100/62/38% tints) and 13 plates' worth of Gemini-3-Pro-Image prompt pairs (a/b candidates with the chosen one marked), plus `check_plate_provenance.py`. | Bears directly on open decision §6.5 (Swiss cover and plates) — this may already be exactly the "research brief in progress" the handoff mentions, or a distinct earlier pass. Worth reconciling against `SWISS-BRIEF.md` before treating as separate. |
| `wave-16/figure-gates` | `docs/harbor-research/exposition/figures/figure-register.schema.md` (an 11-column metadata schema for the figure register/triage files with cross-check rules) + `scripts/harbor-research/check_figure_register.py`, `check_figure_gate_results.py`, `render_figure_audit.py` + `blockers.json` (a waiver-tracking gate). | A concrete CI-gate proposal for the "no figure ships without a verdict" discipline the ledger already half-has (`FIGURE-TRIAGE.md`). Worth checking whether this schema is stricter/better than whatever's landed. |
| `wave-16/textbook-craft-skill` (**since merged to main**, see `skills/textbook-craft/`) | a full pedagogy skill (page-by-page chapter template, exercise-ladder fading theory citing Pólya/Mason–Burton–Stacey, claim-kind macros) citing Halmos, Axler, SICP, Knuth, Feynman, Sipser, CLRS, MacKay, Lakatos, Hersh. | Handoff §8 lists `harbor-exposition` as the skill that helps with prose; this looks like a parallel, possibly more complete pedagogy skill that never got merged. Worth a direct compare — could be strictly better than what's in use, or could be the draft that `pd-pedagogy.tex` superseded. |
| `wave-16/banned-phrases` | Routine — a wordlist pass. Skip. | |

### 1.2 Deep research documents, standalone and citable

- **`INVENTORY.md` + `PLAN.md`** (pulled into this PR at `whitepaper-foundlings/papers-overhaul/`; source: `worktree-papers-cohesion-overhaul`, `recover/wt-papers-cohesion-overhaul`) — a detailed editorial audit naming 26+ cross-cutting cohesion defects across the original 7 papers (terminology overload across layer/organ/phase/proof, status-encoding contradictions, missing failure-red convention, exercise-block courseware intrusion) plus a restructuring plan around a "Harbor Edifice" (4 Floors × 4 Beams) framing. This is exactly the kind of thread-inventory work the handoff's open decision §6.3 (which threads serve the spine) calls for — worth reading before doing that inventory from scratch.
- **`.scratch/agent-coordination-research.md`, `multiplayer-input-research.md`, `pheromone-visualization-research.md`, `note-abstraction-audit.md`** (`recover/stranded-2026-06-18`) — four ~1000-line prior-art surveys (FIPA/KQML/ActivityPub/Discord for directory services; Figma/Linear/Loom for human-swarm input; CodeScene/Gource/ACO-sim for pheromone visualization) plus an empirical audit of a 720MB/44-table production DB showing specific coordination surfaces are nearly unused (`agent_inbox`: 46 lifetime messages). Genuine deep research with concrete numbers, not vibes.
- **`docs/design/pheromone-vocabulary-v1.md` + `docs/shipwright/PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`** (`design/pheromone-vocabulary-v1`) — an 18-kind pheromone taxonomy with per-kind decay half-lives, three always-visible urgency kinds, and a cited bivariate-choropleth visualization rationale. Complete, not a sketch.
- **`research/empirical-closure`** — pulled into this PR at `whitepaper-foundlings/empirical-closure-and-voice-rules/`: three research memos (circuit breakers, feature-requests, hyperplan) — six safety breakers (CB-1..CB-6) for multi-agent budget/fanout/liveness control, a SMART-scored 12-feature roadmap, and a critical-path execution plan. Also ships a complete, working, testable feature: `.voice-rules.yml` + a voice-rules checker + a GH Action + unit tests — a voice-enforcement CI gate that is small, self-contained, and easy to verify as either landed or not.
- **`research/feat/voice-rule-ci`** — same as above (older, superseded by `empirical-closure`) plus one extra: a ~2500-word "Hive-Mind Realism Check" — a steel-manned critique of the multi-agent swarm vision citing published multi-agent-gain literature and single-threaded-write patterns at Anthropic/Cognition, recommending concrete narrower refactors. Worth reading even if nothing else from this branch is kept.
- **the ADR for a durable security forensics journal** (pulled into this PR at `whitepaper-foundlings/adr-0060-forensics-journal/`; recurs across many `worktree-agent-*`/`recover/*` branches) — an ADR for an append-only, fsync'd, 7-day-prune-independent security violation log (PID-squatting, cap-escalation, note-monotonicity). Concrete, checkable design.
- **the Convoy platform requirements RFC** (pulled into this PR at `whitepaper-foundlings/convoy-platform-requirements/`; source: `worktree-convoy-platform-requirements`) — a substantial RFC from Port Daddy's first real external consumer (expungement.guide), distinguishing a control-plane layer from a business-application layer, with an honesty scorecard against current implementation. Real customer signal, not speculative.
- **`.scratch/pr306-body.md`, `verify_red_to_green.py`, `tube_autoresponder.py`, `crop_demo.py`** (`recover/wt-pd-humanize`, `recover/wt-pd-console-ship`) — a working Playwright E2E harness that drives a mock listening agent to verify a "red test → diagnosis → green" demo end to end, with before/after screenshots. Concrete test infrastructure, not a mockup.
- **the soma / retired-orchestration-tool source audit** — a line-cited audit separating shipped/scaffolded/aspirational claims in two external codebases, identifying three "portable kernels" (graph-diffusion medium, active-inference action selection, retrieval cascade) worth porting. Recurs across dozens of branches; one copy is enough. **Not pulled into this PR**: its entire subject is the retired DAG-of-agents orchestration tool named in §2 below, which this repo's `jury-rig-custodian-contract` test permanently bans by name — in both tracked paths and file text, with no exemption mechanism — and the audit can't be genericized without erasing what it's actually about (its citations are to that tool's own source paths). The original file is intact on its source branch (`recover/*` snapshots that carry it) if the author wants to read it directly before that branch is pruned.
- **`cartographer-index.md` + `spider-connections-2026-06-15.md`** (`recover/wt-agent-aea86f95171b9cfd3`) — a dated roadmap-health snapshot (naming a specific 47-day-stalled blocker) and a systems-thinking note on three concrete feature combinations, each with confidence/effort/risk scored.
- **the v2.5-to-v2.6 red-team dialogue** (pulled into this PR at `whitepaper-foundlings/redteam-dialogue-v25-v26/dialogue-v2.5-to-v2.6.RED.json`; source: `worktree-agent-a7572be08e1ebc1c6`) — a structured red-team review of the whitepaper draft with 5 severity-scored findings (a false correlated-equilibrium framing, an unsourced bond-sizing assumption, uncalibrated bootstrap-transition metrics). If these findings were never resolved, they're still live bugs in the argument.

### 1.3 Interaction-design prototypes (self-contained, genuinely novel)

All eight `proto/*` branches (`comms-ecology`, `fireflies-worktrees`, `ghost-filetree`,
`inspect-spawn-sitrep`, `merge-as-light`, `pheromone-glow`, `soundscape`,
`watch-cinematic`) hold one complete, working, single-file HTML/canvas/WebAudio prototype
each (650–1200 lines), all sharing one design-token vocabulary and motion grammar, none
overlapping with the others in content:
- Agents as fireflies navigating parallel "ghost" worktrees toward the files they're touching
- Pheromone heat-glow on files under recent/hot/cold/failed activity
- A "merge as light" convergence-flash motif for PR landing
- An inspect/spawn/situation-report interaction layer on a living file tree
- A WebAudio "Fleet Breathing" soundscape (comm-blips, merge chime, ambient breath-bed)
- A cinematic "second-monitor" galaxy view for passive fleet monitoring

These are a coherent body of visual-metaphor research for representing swarm activity —
worth a look as a set even if none individually ships, because the *vocabulary* (fireflies
= agents, leaves = notes, lasers = DMs, glow = heat) is reused consistently across all
eight and could be a citable design language on its own.

Related, larger design work:
- **`design/operator-console-v11-synthesis`**: pulled into this PR at `scratch/design/operator-console-v11-synthesis/operator-tui-v10-living-harbor.html` — a 1500+-line "Living Harbor" console mockup (pheromone heat, firefly agents, merge-bezier animation, file-tree STAGE architecture, a full CSS token system).
- **`design/swiss-console-v2`, `swiss-gallery-v2`, `swiss-scout-v2`, `swiss-webapp-v2`**: a Swiss/Maritime design system (Müller-Brockmann grid, IBM Plex + Recursive type, a shared `swiss-maritime-tokens.css`) applied across four operator surfaces. **Disputed**: one pass called these routine/no-unique-content, its partner cited specific file paths and described the content in detail. Needs a direct look, not a vote.

## 2. The redundant giant: one piece of work, snapshotted ~20+ times

A retired DAG-of-agents orchestration platform's "architect" skill suite lives at
`skills/<that-tool>-architect/` on these branches (8-9 companion skills: `-curator`,
`-decomposer`, `-evaluator`, `-looking-back`, `-mutator`, `-premortem`, `-resilience`,
`-sensemaker`, plus 10+ reference docs on execution engines, business model, LLM routing,
skill lifecycle, Thompson-sampling skill selection) and PD-AGENT-SORTIE-PLAN.md (a product
spec for a `pd sortie` ephemeral-multi-agent-mission surface, distinct from `pd fleet` and
`pd agent`; not pulled into this PR — described here only as it exists on those other
branches) appear, byte-for-byte or near-identical, in **more than twenty** of the 139
branches — nearly every anonymous `worktree-agent-*` and `recover/wt-agent-*` hash branch,
plus several named ones. This is clearly one substantial design effort — its own proper
name is the exact string this repo's `jury-rig-custodian-contract` test bans, so it's not
spelled out here — that got carried along in every stale worktree snapshot
before pruning, not twenty separate finds. Also riding along in most of the same branches:
eight `fleet/*.sh` scripts (a working background-agent supervisor: `dock-master.sh`,
`documentarian.sh`, `git-gardener.sh`, `research-scout.sh`, `simplifier.sh`, `spark.sh`) and
a `fleet-live-app/` SwiftUI macOS menu-bar app (full Xcode project).

**If this is worth reviving, pull it once** — e.g. from `recover/stranded-2026-06-18` or
`worktree-agent-ac428f506e0f01581`, both of which carry the fullest copies — rather than
comparing all twenty-odd copies against each other.

## 3. Smaller, specific, easy-to-verify items

All six items below are now pulled into this PR under `scratch/section3-salvage/` and
`scratch/actor-coordination/` (isolated from the live `lib/`/`apps/`/`core/` trees; see
those folders' own READMEs) rather than left on their source branches:

- **backend-bin-resolver.ts** (source: `worktree-backend-bin-resolver`) — resolves absolute CLI binary paths at install time so a launchd/systemd daemon with a minimal PATH can still find them. Small, self-contained, plausibly still missing from `lib/` on main.
- **cli-codex-transcript.ts** + tests (source: `recover/wt-agent-a4d34cc31e8e9cf4a`) — a JSONL transcript parser for Codex CLI v0.139.0, handling both the wrapped-item and flat event schemas. The equivalent parsers for Claude/Gemini/Cloudflare were confirmed already in `lib/spawner/` on main by the same sweep; this one specifically was not checked against main by the agent that found it.
- **product-marketing-context.md** + **content-strategy-2026-06.md** (source: `worktree-humanize-copy`) — a full product positioning and voice-guideline document.
- `apps/relay/*` (source: `worktree-relay-v0-build`) — a complete relay app (auth, crypto, OIDC, harbor-channel) with ProVerif verification and matching ADRs/runbooks. **Confirmed already on main in full**, including the ProVerif proof (`analyses/relay_e2e_secrecy.pv`) and its ADR (`docs/adr/0027-relay-harbor-mesh.md`) — nothing pulled from this branch, it is entirely superseded.
- **media-capture-runbook.md** (source: `worktree-agent-aa00fb5704557b371`) — found and fixed a real bug (three marketing-site screenshots were byte-identical despite claiming different UI panes); the runbook for correct capture is the artifact.
- **conjure.rs**, a `core/pd-console/` GPUI shell prototype (source: `design/console-persona`, `worktree-pd-console-gpui-shell`) — likely the seed of the `gpui-rust-console` skill that already exists on main; check whether the prototype code itself (not just the skill write-up) landed.
- **maritime-actors.ts** + the `docs/agent-runs/2026-05-06-followup-fanout/` orchestration runbooks (source: `worktree-whitepaper-rewrite-and-design-pass`) — a typed actor-coordination model (attached/recoverable/detached/dormant states, mailbox/lease semantics) and a real multi-agent fan-out runbook from an actual 6-worktree parallel run.

## 4. Named but not found, or already gone

`recover/wt-adr0050-rent-slash`, `recover/wt-blast-radius`, `recover/wt-cut-run`,
`recover/wt-gh-relay-ingress`, `recover/wt-pd-anchor-mac`, `recover/wt-pd-berth-demo` —
one scanning pass hit git object corruption on these mid-run and reported them
inaccessible; a second, later pass (after the corruption cleared or a fresh fetch) *did*
read most of these and found the same retired-tool/fleet/sortie content as their siblings
(see §2) plus, on `recover/wt-pd-anchor-mac` specifically, a dotfile execution trace under
that same retired tool's config directory. Nothing branch-unique beyond §2 was found once
they were actually readable.
`recover/wt-agent-a075f83ad9fc7c89d`, `-a0bf7c2d6db14481f`, `-a219c103a639cb87a`,
`worktree-agent-a48a736d234b1da43`, `recover/wt-agent-a515e48ab09916ec9`,
`-a6e675ccc26efa634`, `-aaf53b0ad59db2300` do not exist on the remote (never pushed, or
already deleted).

## 5. Confirmed already superseded — safe to delete without further look

`paper/agent-economy-anchor`, `paper/discovery-guilds`, `paper/identity-reputation`,
`paper/legibility-leviathan`, `paper/north-star-index` — early (2026-06-05) north-star
whitepaper drafts, confirmed by both passes to be strict subsets of what's now in main's
`docs/research/north-star/`. `paper/tokens-compaction`, `papers/round3-crypto-honesty` —
confirmed identical to main. Most `figs/brand-palette-*`, `figs/purge-cinnabar-systemwide`
— routine palette-cleanup commits, nothing unique. `design/mobile`,
`design/suggestibility-briefing-spec`, `design/cartographer-durable-approver` (doesn't
exist), `design/console-persona` (git-corrupted, unread) — routine or inaccessible.

**Caution on `paper/harbor-economy`, `paper/legible-swarm`, `paper/single-writer-kernel`,
`paper/spawn-to-person`, `paper/wave3-bundle`, `papers/explainable-set`**: these were
flagged by one pass as holding ~30+ unmerged `.tex` figures (fig-he-*, fig-swk-*,
legible-swarm-*, fig-stp-*). Several of the *specific* figures named
(`fig-stp-not-bandit`, `fig-stp-honest-state`, `fig-stp-stack-map`,
`fig-stp-estimator-family`, `fig-stp-keystone-split`) match figures the book's own Wave 11
editorial pass **deliberately cut** (turned into tables, or removed as decorative) per the
build ledger's Round 4/5 entries — their absence from main is a decision already made, not
an oversight. Don't resurrect these without checking with whoever made that cut.

## 6. Not treasure, just cache — pulled in anyway on explicit instruction

`.scratch/figaudit/` and `.scratch/audit/` in `recover/wt-paper-figures-love` and
`recover/wt-papers-cohesion-overhaul` are rendered screenshots from a figure-review pass,
not authored work. My original recommendation here was to leave them alone — useful only
as a before/after reference, not worth carrying forward as "research." **The author
overrode that recommendation** and asked for them explicitly ("bring into that folder
./scratch/figaudit/ and audit/ ... I want to review all of this visually"), so they are
pulled into this PR at `whitepaper-foundlings/figaudit-and-audit-screenshots/`. The
"not treasure" verdict above stands as the reason this bucket is a low salvage priority,
not as a description of what actually shipped in this diff. (Also corrected here: the
original scan estimated 924 and 1105 files; the real counts are 113 and 292 — 405 total,
~141 MB.)

## 7. Recommended next step

Given the number of genuinely distinct finds above (§1.1–1.3 especially), I'd suggest:
1. Reconcile §1.1 against the live PR's open decisions (§6 of `HANDOFF-TEXTBOOK.md`) first
   — several of these branches look like they may already answer questions the handoff
   lists as open (the Swiss plates, the literature review, the thread-inventory).
2. For §2 (the retired-tool/sortie/fleet redundant giant), a single yes/no on "is this still a
   live direction" decides ~20 branches at once.
3. Everything in §5 can be deleted now; the branches in §4 that don't exist need no action.
4. Nothing else should be deleted until someone has actually opened the specific
   files named in §1 and §3 — this document names exact paths so that's a fast check,
   not a re-scan.
