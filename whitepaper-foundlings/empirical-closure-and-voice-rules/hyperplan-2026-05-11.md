# Hyperplan: research/empirical-closure execution

**Drafted:** 2026-05-11 · **Branch:** `research/empirical-closure` · **Source:** `feature-requests-2026-05-07.md`
**Author:** Drafted by Claude (Opus 4.7) on behalf of Erich Owens / Curiositech LLC
**Status:** Awaiting Wave 0 green-light

---

## TL;DR

12 features. Serial estimate: **23 working days.** Critical-path estimate with parallelization: **~8.5 days** (≈2.7× speedup). Four waves. Each wave gated, each subtask skilled, each commit guarded.

Honest tradeoff: the speedup comes from running 5 agents in parallel during Wave 1. That's the riskiest window of the entire program — five branches touching substrate schema simultaneously. Mitigation is rigid sub-branching plus an always-on auditor agent. If we can't keep 5 agents from colliding, we fall back to ~16 days.

---

## Dependency graph (the why behind the waves)

```
                       ┌── #10 voice-rule CI ─────────────────────────────────┐
Wave 0 (pre-flight) ───┤                                                       │
                       └── H1–H7 nominal-state diagnostic ─────────────────────┤
                                                                               ▼
              ┌── #2  Model provenance schema ───────────────┐                 │
              ├── #12 Tree-of-agents (parent_session_id) ────┤                 │
Wave 1 ───────┼── #5  pd hitl ask ───────────────────────────┤                 │
              ├── #6  Salvage triage UX ─────────────────────┤                 │
              └── #11 Frozen substrate mode ─────────────────┤                 │
                                                             ▼                 │
              ┌── #1  pd conservation ───────────────────────┤ (needs H4)      │
              ├── #3  Mid-claim collision handler ───────────┤ (uses #11)      │
Wave 2 ───────┼── #7  Decision-level cost attribution ───────┤ (needs #2)      │
              └── #9  Expressive-act classification ─────────┤ (needs #2)      │
                                                             ▼                 │
              ┌── #4  pd experiment primitive ───────────────┤ (needs 1,2,7)   │
Wave 3 ───────┴── #8  pd route ───────────────────────────────┤ (needs 2,5,11) │
                                                              ▼                │
                                                   Empirical runs + paper writes
```

**Critical path:** Wave 0 (0.5d) → Wave 1 longest (#2 or #5 @ 2d) → Wave 2 longest (#3 @ 3d) → Wave 3 longest (#4 or #8 @ 3d) = **8.5d wall-clock**.

---

# Wave 0 — Pre-flight (≤ 1 day, 2 agents parallel)

**Goal:** Substrate must be measurable before we start measuring it. Voice rule must be enforced before we start writing the paper.

| Subtask | Days | Primary skill | Sub-branch |
|---|---|---|---|
| H1–H7 nominal-state diagnostic | 0.5 | `ci-status-checker` + `build-verification-expert` | `research/diag/nominal-state` |
| #10 Voice-rule CI + fix existing byline drift | 0.5 | `github-actions-pipeline-builder` | `research/feat/voice-rule-ci` |

**Gates to enter Wave 1:**
- H1–H7 either green or **explicitly deferred with a written risk note** (deferral itself becomes a paper appendix).
- Voice-rule CI passes on the existing tree (which means the `Port Daddy Engineering Team` byline in `dist/whitepaper/*.tex` is fixed in the same PR).
- Full test suite green; if pre-existing failures (telemetry test) still red, document them and decide: fix-now vs. accept-as-known.
- `pd guard status` confirms `enforce`.

---

# Wave 1 — Foundational schemas (≤ 2 days, 5 agents parallel)

**Goal:** Land the schema and primitive changes that everything else depends on. Every item lives on its own sub-branch off `research/empirical-closure`. The auditor agent reviews each PR before merge back to the lab branch.

| Subtask | Days | Skill (primary / secondary) | Sub-branch |
|---|---|---|---|
| **#2** Model provenance on notes/claims/spans | 2 | `schema-evolution-manager` / `data-lineage-tracker` | `research/feat/provenance-schema` |
| **#12** Tree-of-agents (`parent_session_id`) | 2 | `observability-apm-expert` / `database-migration-manager` | `research/feat/tree-of-agents` |
| **#5** `pd hitl ask` | 2 | `human-gate-designer` / `agentic-zero-trust-security` | `research/feat/pd-hitl-ask` |
| **#6** Salvage triage UX | 1 | `dimensional-modeler` / `data-quality-guardian` | `research/feat/salvage-triage` |
| **#11** Frozen substrate mode | 1.5 | `state-machine-designer` / `runtime-verification-for-agents` | `research/feat/frozen-substrate` |

**Parallelization risk and mitigation:**
- All five touch the daemon's SQLite schema or coordination primitives.
- **Rule:** no agent merges to `research/empirical-closure` without auditor PR review.
- **Rule:** migrations are additive-only (new columns/tables, no renames or drops). The 250-corpse production DB is the source of truth.
- **Rule:** if a sub-branch needs a schema field another sub-branch is also adding, the second one rebases on the first — auditor enforces FIFO merge order.
- An always-on `cartographer` agent watches all five sub-branches and posts collision-prediction every 30 min using `lib/symbol-index.ts` (the existing tree-sitter symbol DB).

**Gates to enter Wave 2:**
- All five PRs merged to `research/empirical-closure`.
- Full test suite green on the lab branch after the fifth merge.
- Production daemon restarted on the new code; migrations applied cleanly to the 250-corpse db; no zombie spans created.
- `pd conservation`'s prerequisite — cost ledger trustworthy — verified by running 100 synthetic ops and checking telemetry recovery is 100% across claude-cli + ollama (Codex/Gemini/Workers can lag if auth isn't wired).

---

# Wave 2 — Primitives (≤ 3 days, 4 agents parallel)

**Goal:** Build the measurement primitives that the paper's central claims rest on.

| Subtask | Days | Skill (primary / secondary) | Sub-branch | Depends on |
|---|---|---|---|---|
| **#1** `pd conservation` runtime check | 1 | `tlaplus-practitioner` / `runtime-verification-for-agents` | `research/feat/pd-conservation` | H4, #2 |
| **#3** Mid-claim collision handler | 3 | `semantic-conflict-prediction` / `event-driven-architecture-expert` | `research/feat/claim-collision-handler` | #11 (freeze for experiments) |
| **#7** Decision-level cost attribution | 2 | `cost-accrual-tracker` / `cost-verification-auditor` | `research/feat/decision-cost` | #2 |
| **#9** Expressive-act classification (Haiku) | 2 | `fipa-00037-communicative-act-library` / `prompt-engineer` | `research/feat/expressive-act` | #2 |

**Wave-2 gates:**
- Conservation Theorem **measurably holds** on production data over a 1-hour window. Paper figure 1 is now writable.
- Cost-by-action sum **equals** cost-by-session sum (cost-side conservation; mirrors #1).
- Expressive-act classifier audit on 20 random messages ≥ 90% agreement with manual reading.
- Mid-claim collision handler ships behind `PD_CLAIM_COLLISION_HANDLER=on` flag; one fleet smoke-test pass with two parallel writers shows expected event + inbox delivery.

---

# Wave 3 — Composition (≤ 3 days, 2 agents parallel)

**Goal:** Build the two reproducibility-grade composition primitives that turn raw measurements into paper figures.

| Subtask | Days | Skill (primary / secondary) | Sub-branch | Depends on |
|---|---|---|---|---|
| **#4** `pd experiment` primitive | 3 | `feature-manifest` / `dag-replay-debugger` | `research/feat/pd-experiment` | #1, #2, #7 |
| **#8** `pd route` cheap-tier ensemble | 3 | `llm-router` / `llm-cost-optimizer` | `research/feat/pd-route` | #2, #5, #11 + auth |

**Wave-3 gates:**
- A real two-agent experiment (one Claude, one Ollama) runs end-to-end. Manifest hash reproducible. `pd experiment replay <hash>` works.
- A routing decision under `pd route --task classification --quality draft` saves ≥30% vs. Sonnet baseline on a 20-item eval set. (We need the eval set, even if small.)

---

# Quality gates (cross-cutting, always-on)

## Per-commit (every agent, every commit)
- `pd guard check --staged` passes.
- `npm test -- --runInBand` full suite green (no skipping, no `.only`).
- `tsc --noEmit` + `npx vite build` both green (per CLAUDE.md feedback memory — esbuild catches JSX errors tsc misses).
- Voice-rule CI green (once #10 lands in Wave 0).
- Feature manifest entry exists for any new route/CLI/MCP tool.
- CHANGELOG entry per CLAUDE.md "changelog automation protocol."

## Per-PR (auditor agent reviews before merge to lab branch)
- Migration is additive-only, runs cleanly on a copy of production DB.
- New tests added cover the SMART-Measurable bullet from the feature-requests doc.
- No spans/notes/claims emit without model provenance (after #2 lands).
- No bypass of coordination guard (`PD_SHIM_OFF=1`, `--no-verify`, `--no-gpg-sign`).
- Doc updated: README / feature-manifest / CHANGELOG.

## Per-wave (redteam-review skill before unlocking the next wave)
- Adversarial red-team pass on the wave's deliverables.
- Fleet smoke test: spawn 3 agents, watch for known fragilities (session-routing bug, mid-claim collision, telemetry loss).
- Salvage drain pass: corpses-past-7-days down to zero (or documented why not).

## Continuous (background fleet agents)
- `cartographer` — watches all sub-branches, posts collision-prediction every 30 min.
- `auditor` — runs on every PR open, blocks merge if any per-PR gate fails.
- `archivist` — at end of each wave, snapshots daemon state into paper's figure folder.
- `researcher` — drafts paper sections from each landed feature so the paper accretes in lockstep with the substrate.

---

# Agent prompt template

Every skilled agent gets a prompt with this exact spine. The bracketed sections are filled per-item from the feature-requests doc.

```
ROLE: You are the [PRIMARY-SKILL] agent for feature request #[N]: [TITLE].

SOURCE OF TRUTH:
- Read docs/research/feature-requests-2026-05-07.md item #[N] first.
- Branch off origin/research/empirical-closure into research/feat/[slug].

COORDINATION CONTRACT (CLAUDE.md mandates this in port-daddy repo):
- pd begin --identity port-daddy:research:feat-[slug] --purpose "[N] [title]"
- pd session files add <path> before EVERY edit.
- pd note at: start, mid-implementation, tests-pass, PR-ready.
- git fetch origin && rebase on origin/research/empirical-closure before every commit.
- pd guard check --staged before every commit. NEVER bypass with PD_SHIM_OFF=1.

SCOPE:
- Files allowed: [explicit list from item's deliverables]
- Files forbidden: [explicit list — e.g. lib/db.ts core schema if not yours]
- Migration policy: additive-only, runs cleanly on 250-corpse production DB copy.
- Feature flag: PD_[FEATURE]_ENABLED=[on|off]; default off if user-facing.

DELIVERABLES (from feature-requests doc, item #[N]):
- [Specific deliverables verbatim]
- Tests in tests/unit/[file].test.ts covering the Measurable bullets.
- Feature-manifest entry for any new route / CLI / MCP tool.
- CHANGELOG entry (category + version per CLAUDE.md changelog protocol).
- PR to research/empirical-closure with body linking to feature-requests doc.

QUALITY GATES (all must pass before declaring done):
- npm test -- --runInBand: full suite green.
- tsc --noEmit + npx vite build: both green.
- pd guard check --staged: pass.
- Voice-rule CI: green (after Wave 0).
- No new telemetry-loss spans introduced.
- Auditor PR review: approved.

HITL TRIGGERS (pd hitl ask the human if):
- Scope must grow beyond declared deliverables.
- Cost projection > $20.
- Test failures you can't resolve in one cycle.
- Coordination collision with another active sub-branch.

OUTPUT:
- One PR titled: "feat(#[N]): [title]"
- Body: link to feature-requests doc; summary of what landed; test results; screenshots if UI.
- pd done "[N] [title] shipped. Validation: <evidence>. Remaining: <risk>."
```

---

# Skill / agent assignments (master table)

| # | Title | Primary skill | Secondary | Wave |
|---|---|---|---|---|
| H1-H7 | Nominal-state diagnostic | `ci-status-checker` | `build-verification-expert` | 0 |
| 10 | Voice-rule CI | `github-actions-pipeline-builder` | `archivist` | 0 |
| 2 | Model provenance | `schema-evolution-manager` | `data-lineage-tracker` | 1 |
| 12 | Tree-of-agents | `observability-apm-expert` | `database-migration-manager` | 1 |
| 5 | `pd hitl ask` | `human-gate-designer` | `agentic-zero-trust-security` | 1 |
| 6 | Salvage triage UX | `dimensional-modeler` | `data-quality-guardian` | 1 |
| 11 | Frozen substrate | `state-machine-designer` | `runtime-verification-for-agents` | 1 |
| 1 | `pd conservation` | `tlaplus-practitioner` | `runtime-verification-for-agents` | 2 |
| 3 | Collision handler | `semantic-conflict-prediction` | `event-driven-architecture-expert` | 2 |
| 7 | Decision-level cost | `cost-accrual-tracker` | `cost-verification-auditor` | 2 |
| 9 | Expressive-act class. | `fipa-00037-communicative-act-library` | `prompt-engineer` | 2 |
| 4 | `pd experiment` | `feature-manifest` | `dag-replay-debugger` | 3 |
| 8 | `pd route` | `llm-router` | `llm-cost-optimizer` | 3 |

Cross-cutting always-on: `cartographer`, `auditor`, `archivist`, `researcher`, periodic `redteam-review`.

---

# Failure protocols

**Wave collapses to serial** if:
- ≥ 2 Wave-1 sub-branches fail per-PR gate twice in a row → drop parallelism to 2 agents max.
- Cartographer reports ≥ 3 collision-predictions on the same file pair → freeze that file in the lab branch, route through coordinator.

**Wave aborts and rolls back** if:
- Conservation Theorem **fails** to hold in Wave 2 (cost-ledger violation detected). That's a substrate bug, not a feature; halt, fix, re-run.
- Migration breaks the 250-corpse production DB on staging restore. Roll back the offending PR, write a postmortem, redesign migration.

**Paper aborts** if (would require a real conversation):
- Heterogeneous-ensemble ablation in Wave 3 shows no measurable improvement over homogeneous baseline. Then the paper's contribution shifts entirely to substrate + taxonomy; ensemble becomes negative result (still publishable, but different paper).

---

# Cost estimate (LLM spend during execution)

- ~100 skilled-agent invocations × $2–3 average (claude-cli, Opus 4.7 for complex, Sonnet for routine) = **$200–300**.
- Haiku classification batches (item #9, ~5000 messages × $0.001) = **~$5**.
- Auditor / cartographer continuous runs (~24h × 8.5d on cheap-tier) = **~$50**.
- **Total: ~$300, with one big-compute bullet still possible in Wave 3** (if eval set for `pd route` needs GPU inference) — that comes through `pd hitl ask` as a written proposal first.

---

# What I need from you to start Wave 0

One question:

1. **Greenlight Wave 0 now?** (kicks off H1–H7 diagnostic + voice-rule CI, parallel, ~1 working day) — OR — **do you want me to run `/next-move` over this plan first** for the windags meta-DAG critique (sensemaker → decomposer → skill-selector + premortem → synthesizer → PredictedDAG) before I touch anything?

The first answer puts agents on the substrate within minutes. The second buys you an adversarial gate from your own meta-system before any work starts. Both are reasonable.

---

**Signature**

Drafted by Claude (Opus 4.7) on 2026-05-11 for:

**Erich Owens**
*Curiositech LLC*

Source: `docs/research/feature-requests-2026-05-07.md`. Pending Wave-0 greenlight.
