# 0052. Trajectory Export and the Coordination RL Loop

## Status

Partially superseded by [`Empirically Earned Fleet Doctrine`](../proposals/empirically-earned-fleet-doctrine.md).

The doctrine proposal is now the canonical architecture for institutional
learning: cited decision episodes, falsifiable candidates, preregistered
experiments, advisory retrieval receipts, agent response, and verified outcome
belong in one append-only Harbor evidence stream. The CASE-13 vertical slice
implements that chain in source without claiming an automatic causal learner.

This ADR remains authoritative for the **unbuilt downstream work** that does
not conflict with that ownership: redacted trajectory export, honest outcome
labeling, synthetic evaluation, scaffold optimization, SFT/preference datasets,
and conditional RL experiments. Those consumers must read from the doctrine
evidence contract rather than become a second canonical learner.

The change is a supplanting boundary, not a historical rewrite: reward-first
policy optimization and an exporter-as-canonical-store are retired as the
organizing architecture; the exporter and evaluation work remain valuable
projections and experiments.

## Context

Port Daddy's daemon already records, in one canonical SQLite database, almost
everything a learning pipeline would need to train an agent to *coordinate
well*: **sessions** (`lib/db.ts` — *the unit of one agent's scoped work, with
purpose, phase, and lifecycle timestamps*), **session notes** (`session_notes`,
immutable per ADR-0007), **file claims** (`session_files` — *advisory
intent-announcements down to line ranges and symbols*), the **activity log**
(`activity_log` — *typed events including `claim_violation`*), **sorties**
(`lib/sortie-*`/`sorties`, `sortie_events` — *budgeted dispatched agent runs
with streamed transcripts*), **commitments** (ADR-0041 — *violable promises
caught by a monitor*), **cost events** (`cost_events` — *per-call token and
dollar accounting keyed by identity and spawn*), inbox traffic (`agent_inbox`,
`messages`), roadmap linkage (`roadmap_claims`, ADR-0034), and Coast Guard
compulsion verdicts (ADR-0050 phase 4 — *note-before-commit rent, enforced at
the commit path*).

Read together, these tables are **trajectories**: time-ordered sequences of
(state, action, observation) with *verifiable outcomes* attached — exactly the
raw material of **reinforcement learning** (Sutton & Barto 2018, *learning a
policy by optimizing a reward signal over interaction episodes*). Teams that
want to train coordinating agents normally have to build the environment, the
telemetry, and the reward function from scratch. We have all three as a side
effect of operating the harbor. What we do **not** have is:

1. A way to get episodes *out* in a stable, consumer-friendly shape (today the
   data is implicit in a dozen normalized tables plus harness transcripts).
2. **Outcome labels** joining a session to what actually happened to its work
   (PR merged? CI green? reverted? guard-blocked? collided with another agent?).
3. A declared, versioned **reward rubric** so that "this was a good coordination
   episode" is a computation, not vibes.

A second observation motivates urgency: ADR-0050's compulsion rent is a
*hand-written reward-shaping function*. Every rule the Coast Guard enforces
("no note since last commit → blocked") is a human guess at what good harbor
citizenship looks like. A trajectory corpus with outcome labels lets us *check
those guesses against evidence* and eventually train agents that internalize
the behavior instead of being fenced into it.

## Decision Drivers

- **One source of truth.** The daemon SQLite DB is canonical (ADR-0001,
  ADR-0044). Training data must be *derived* from it on demand, never forked
  into a second live store that drifts.
- **Honest labels.** Outcome labels follow the ADR-0045 discipline: a label is
  `VERIFIED` only when the evidence chain exists (session → commit → PR →
  merge state), otherwise it is `UNKNOWN` — never inferred to look complete.
  Training on fabricated labels is worse than training on fewer episodes.
- **Consumer-agnostic.** The same export must feed four different consumers
  (benchmark, prompt optimization, supervised fine-tuning, RL) without
  re-extraction. That forces an episode schema, not a per-consumer dump.
- **Privacy by default.** Notes and transcripts contain repo paths, prompts,
  and occasionally secrets. Export redacts by default; raw mode is explicit.
- **MCP parity.** Agents are first-class consumers; the export gets a real
  MCP tool, not a CLI-only carve-out.

## Considered Options

- **A. Train on harness transcripts alone (Claude Code JSONL, sortie streams).**
  Rejected: transcripts capture *what an agent said and called*, but none of the
  coordination substance — no claims, no collisions, no guard verdicts, no
  outcome linkage. You can learn tool-call syntax from transcripts; you cannot
  learn *harbor citizenship*.
- **B. Stream daemon events to an external store (warehouse/OTLP) and build
  training sets there.** Rejected for now: a second source of truth that
  drifts from the canonical DB, plus standing infrastructure for a workload
  that is batch by nature. Revisit if episode volume outgrows SQLite scans.
- **C. (chosen) A first-class exporter — `pd export trajectories` — that reads
  the canonical DB, joins the coordination tables into a versioned Episode
  JSONL, attaches honest outcome labels and a versioned reward annotation, and
  becomes the single substrate for the benchmark → prompt-optimization → SFT →
  RL ladder.** Spec: `docs/proposals/pd-export-trajectories.md`.

## Decision

Build the **trajectory export** (spec in `docs/proposals/pd-export-trajectories.md`)
and adopt the four-consumer **coordination RL loop** below as the intended use
of the data. The exporter is the only new load-bearing daemon surface; every
training consumer lives *outside* the daemon and treats Episode JSONL as its
contract.

### The Episode

An **episode** is one session, widened to everything the harbor knew about it:

- **Steps** — the merged, time-ordered event stream: notes, claims/releases,
  activity entries, sortie events, inbox sends/receives, commitment
  open/close, lock acquire/release, guard verdicts.
- **Outcome** — labeled terminal facts: PR number/merge state/CI state where
  linkable, guard blocks suffered, claim collisions caused or absorbed,
  salvage adopted or abandoned, session end state (`done` vs TTL-out).
- **Rewards** — a versioned rubric evaluation (below), stored as annotation,
  never as ground truth.
- **Costs** — tokens and USD from `cost_events`, so every consumer can
  optimize quality *per dollar*, not quality alone.

### The reward rubric (versioned, computed, anti-Goodhart)

Every reward term must name its evidence in the DB. The initial rubric,
`coordination-reward/v1`:

| Term | Sign | Evidence (table → condition) |
|---|---|---|
| Task completed | + (terminal, dominant) | `sessions.status='completed'` AND linked PR merged with green required checks |
| Honest closure | + | `pd done` with a Result note (`session_notes.type`), vs TTL-abandonment (`resurrection_queue` entry) |
| Zero guard friction | + | no Coast Guard block events for the session (requires phase-1 verdict persistence) |
| No collisions caused | + / − | `activity_log.type='claim_violation'` where session is violator (−) or absorbed gracefully (+) |
| Salvage adopted | + | session begins from a `resurrection_queue` claim and closes it |
| Claim hygiene | − | breadth penalty: Σ(files-claimed × hold-time) ÷ files-actually-edited — punishes claiming the world to avoid collisions |
| Note quality | + cap | rent satisfied (note-per-commit, ADR-0050) — capped so note *spam* cannot farm reward; redundancy detected by embedding similarity between consecutive notes, never keyword matching |
| Responsiveness | + | `agent_inbox` reply latency on addressed messages |
| Commitment kept | + / − | `commitments.state` transitions (kept vs breached, ADR-0041) |
| Budget discipline | − | `cost_events` total vs `sorties.budget_usd`; overrun is negative reward, not a clipped zero |

Anti-Goodhart commitments, stated now because every one of these *will* be
gamed: (1) reward **outcomes, not rituals** — the ritual terms (notes, claims)
are capped and the terminal term dominates; (2) the breadth penalty makes
over-claiming strictly worse than negotiating; (3) any rubric change bumps the
version string and old annotations are never silently recomputed; (4) after
every rubric change, an explicit Goodhart audit: sample top-scoring episodes
and read them — if they look like reward-farming, the rubric regresses.

### The four consumers — how the RL information is actually used

**Consumer 1 — Coordination-Bench (evaluation; build first).**
A synthetic harbor built from the existing ephemeral daemon
(`tests/helpers/ephemeral-daemon.js`) plus generated repos with planted
hazards: two tasks whose edits overlap unless agents claim regions and
negotiate; a dead session with salvage worth adopting; an inbox message that
must be answered before a dependent step; a merge queue that punishes bad
sequencing. An agent (any agent — Claude, Codex, a local model, a new prompt
revision) runs an episode; the rubric scores it from the event log. This is
the reward function made executable, and it pays for itself before any
training happens: it becomes the **regression gate for coordination
behavior** — a change to `port-daddy-agent-skill`, AGENTS.md choreography, or
the spawn wrappers must not lower the bench score, the same way code changes
must not break tests. Real-fleet episodes exported by this ADR are the
*naturalistic* eval set; the synthetic harbor is the *controlled* one.

**Consumer 2 — Scaffold optimization (cheapest training; do before weights).**
We cannot fine-tune Claude, and Claude is the strongest coder in the fleet, so
the highest-leverage optimization target is the *scaffold*: the prompts,
skills, and choreography text. Run **prompt evolution** (GEPA / DSPy-style
optimizers, Khattab et al. 2023 — *treating prompts as parameters optimized
against a metric*) with the bench score as the metric: generate prompt
variants, run bench episodes, keep what scores, iterate. Recent results show
reflective prompt evolution competitive with small-scale RL at a tiny fraction
of the cost. The trajectory corpus feeds this twice: high-scoring real
episodes become few-shot exemplars *inside* the evolved prompts, and
low-scoring episodes become the failure cases the optimizer is explicitly
asked to fix.

**Consumer 3 — SFT + preference learning (teach the protocol to open weights).**
The strategic premise: **coordination grammar is learnable by a small model;
frontier coding ability is not.** So the tuned model is not a better coder —
it is a *coordination-native fleet citizen* for protocol-heavy roles: triage,
salvage operation, inbox/navigator duty, merge-queue sequencing, and the
ad-hoc team dispatcher (the talent-phonebook auctioneer of ADR-0030, which is
contract-net (Smith 1980 — *task allocation by announce-bid-award*) wearing a
harbor uniform). Pipeline:

- **SFT**: curate episodes with `outcome.label=VERIFIED` positives (merged PR,
  zero guard blocks, clean closure) into instruction-tuning rows — the episode
  steps become the assistant's tool-call sequence; the session purpose and
  briefing state become the prompt. Target: an open-weights coder
  (Qwen3-Coder-class) LoRA-tuned locally (M4 Max via MLX) or on rented GPUs.
- **Preference pairs (DPO/KTO)**: the corpus mines negatives *automatically* —
  the same situation handled well and badly. Guard blocks, `claim_violation`
  events, TTL-abandoned sessions, and stale claims are negative halves; the
  matched positive is a verified-good episode with similar purpose/identity
  (matched by embedding similarity over purposes — never keyword lists).
  Operator-memory failure modes ("started before briefing", "pushed stale
  work") each describe a minable pattern.
- **Deployment**: the tuned model slots in through the existing spawn surface
  (`pd spawn --backend ollama`, `lib/spawner.ts`) and is declared in
  `pd-fleet.yml` (ADR-0019). The fleet becomes deliberately heterogeneous:
  Claude does the hard diffs; the tuned small model does the choreography at a
  fraction of the cost — and `cost_events` measures whether that trade
  actually pays.

**Consumer 4 — RLVR in the synthetic harbor (the research tier).**
**RLVR** (*reinforcement learning from verifiable rewards — RL where the reward
is computed by a checker, not a learned preference model*) is the right
formulation because the rubric above is exactly a verifier: PR merged, guard
clean, no collisions are checkable facts, not preferences. Practical shape:
**GRPO**-style training (Shao et al. 2024 — *group-relative policy
optimization: score groups of rollouts against each other, no value network*)
over Consumer-1's synthetic harbor, because real-fleet episodes are too slow
and too precious for on-policy rollouts. Requirements this ADR imposes on the
bench for RL-readiness: episodes must run in under a minute (small planted
repos, scripted counterpart agents — not full Claude fleets per rollout), and
scenario generation must be seeded/deterministic so a reward delta is
attributable to the policy, not the scenario draw.

Multi-agent honesty: **credit assignment** for team formation — decomposing a
team-level reward into per-agent contributions — is the genuinely open
research problem (**difference rewards / COMA**, Foerster et al. 2018 —
*counterfactual baselines for multi-agent credit*), and **ad hoc teamwork**
(Stone et al. 2010 — *cooperating with teammates you didn't train with*) is an
open field. We do not gate the project on it. The ladder is: single-agent
episodes with individual rewards → 2-agent scenarios with individual rewards
plus a small shared team bonus → only then team-level credit experiments.

### Sequencing and the decision boundary

Phases 0–3 (export, labels, rubric, bench) are committed by this ADR. Phase 4
(scaffold optimization) is committed once the bench exists, because it is
near-free. Phases 5–6 (SFT/DPO, RLVR) are **conditional**: we commit to them
only if the bench shows a measurable coordination gap that prompt evolution
cannot close, demonstrated by at least two optimization rounds plateauing
below the target score. Nothing in 0–4 is wasted if 5–6 never run — the bench
is CI for coordination behavior, and the export is an audit/replay surface in
its own right (it subsumes the triage-cluster vision of the PD-DB taxonomy
note and feeds `episodic_memory`, ADR-0035).

### Data governance

- Export **redacts by default**: secret-shaped strings (structured token
  formats + entropy screens — pattern-matching on *structured* formats, which
  the no-keyword-NLP rule explicitly permits), user paths normalized,
  `--no-redact` is an explicit local-only flag.
- Episodes are **derived artifacts**: deleting/regenerating an export never
  touches the canonical DB; immutability of notes (ADR-0007) is preserved by
  construction.
- Any future *sharing* of episode corpora (e.g., a public coordination
  benchmark) is a separate operator decision; this ADR authorizes local use
  only.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0052-phase-0-episode-schema-and-exporter | now | — | Episode JSONL schema v1 + `pd export trajectories` CLI + `GET /export/trajectories` route + `export_trajectories` MCP tool; session-rooted join (sessions, session_notes, session_files, activity_log, sortie_events, agent_inbox, commitments, cost_events); streaming, cursor-paginated, redact-by-default; unit tests on `createTestDb` + bun-runtime route smoke (per regression-test rule) |
| 1 | adr-0052-phase-1-outcome-labelers | now | adr-0052-phase-0-episode-schema-and-exporter | Honest outcome labels: session→commit→PR→merge/CI chain (VERIFIED/UNKNOWN, never inferred); **persist Coast Guard verdicts** (commit-path allow/block events are currently computed and discarded — store them keyed to session); collision attribution from `claim_violation`; salvage-adoption linkage via `resurrection_queue` |
| 2 | adr-0052-phase-2-reward-rubric | now | adr-0052-phase-1-outcome-labelers | `coordination-reward/v1` as code: versioned, every term cites its evidence row; breadth penalty; note-redundancy via embeddings; rubric annotations attached to exported episodes; Goodhart audit checklist documented |
| 3a | adr-0052-phase-3a-coordination-bench-v1 | now | adr-0052-phase-2-reward-rubric | Synthetic harbor on the ephemeral daemon: seeded scenario generator (overlap/salvage/inbox/merge-queue hazards), scripted counterpart agents, sub-minute episodes, `pd bench coordination` runner emitting the same Episode JSONL; wire as advisory CI gate for skill/choreography changes |
| 3b | adr-0052-phase-3b-coordination-bench-v2 | later | adr-0052-phase-3a-coordination-bench-v1, binder Milestone 8 | Bench over the Milestone-8 vocabulary (Amendment 1): scenario generator parameterized over **org-config × problem** (identical vs heterogeneous roles, stigmergic blackboard vs parley/contract-net, advisory vs enforced claims, local vs remote); counterpart agents span the C7 spectrum (compliant/weak/broken/malicious/stale/remote); defection-pricing metric (bypassing claims must be measurably more expensive than cooperating, binder ch. 05); C7 statistical discipline (preregistered plan, confidence intervals, effect sizes, ≥1 Tier A baseline); a slow eval-only tier for binder problems that exceed the sub-minute constraint (PR-response campaign, UI polish, research synthesis) |
| 4 | adr-0052-phase-4-scaffold-optimization | next | adr-0052-phase-3a-coordination-bench-v1 | GEPA/DSPy loop over `port-daddy-agent-skill` + AGENTS.md choreography with bench score as metric; high-scoring real episodes as exemplars; report per-round score deltas; **evolved prompts/choreography are transcript-derived artifacts — they pass the binder ch. 04 proposal-vs-validation quarantine gate before admission** |
| 5 | adr-0052-phase-5-sft-dpo-datasets | later | adr-0052-phase-2-reward-rubric, binder Milestone 8 (tool grammar freeze) | Dataset curation: VERIFIED-positive SFT rows; auto-mined DPO pairs (guard blocks / collisions / abandonment vs matched positives); train LoRA on open-weights coder; integrate as `pd spawn` backend; cost-vs-quality comparison from `cost_events`. **Target role: Longshoreman** (binder ch. 05 role split) — conflict watcher, salvage shepherd, inbox/parley duty, dispatcher. **First verifiable-reward task: compaction-packet authorship** (binder ch. 04 — a first-class transcript event with a citation-checking validator, i.e. a ready-made reward checker). Corpus-at-scale waits for the Milestone-8 tool grammar so SFT does not freeze a pre-parley vocabulary into weights |
| 6 | adr-0052-phase-6-rlvr-loop | later | adr-0052-phase-3a-coordination-bench-v1, adr-0052-phase-5-sft-dpo-datasets | GRPO/RLVR training against the bench; single-agent first, then 2-agent with shared team bonus; conditional on phase-4 plateau (see decision boundary); scenario draws include C7 stochastic resource pressure (context, cost, tool gates, approval latency) so the policy is not trained under abundance |

## Consequences

### Positive

- The harbor's exhaust becomes an asset with a contract: one episode schema
  feeding evaluation, prompt optimization, fine-tuning, and RL without
  re-extraction.
- Coordination behavior gets a regression gate (the bench), which no amount of
  prose in AGENTS.md currently provides.
- ADR-0050's hand-written rent rules become *testable hypotheses* about good
  citizenship rather than permanent fencing.
- Negative training data is mined automatically from the failure modes the
  operator currently has to keep re-teaching by memory file.

### Negative

- The rubric is a standing Goodhart surface; every term invites farming.
  Mitigated by outcome-dominant weighting, capped ritual terms, versioning,
  and the mandatory post-change audit — but this is a treadmill, not a fix.
- Guard-verdict persistence (phase 1) adds a write path to the commit hot
  path; must stay fire-and-forget so a slow DB can never block a commit
  decision.
- Phases 5–6 carry real GPU cost and real research risk (credit assignment);
  hence the explicit conditional gate rather than a commitment.

### Neutral

- The exporter is read-only over the canonical DB; it adds no new live state
  except persisted guard verdicts, which ADR-0050 arguably owed us anyway.
- Episode JSONL is also the natural substrate for replay/debugging and the
  triage-taxonomy vision, independent of any training ambition.

## Amendment 1 (2026-07-04) — Agent Harbor binder reconciliation

This ADR and the Agent Harbor technical binder
(`docs/architecture/agent-harbor-technical-binder/`) were written in parallel
and, until this amendment, did not reference each other. They describe
overlapping systems. This amendment registers the dependency in both
directions and folds the binder's requirements into the phases. The
corresponding pointers live in binder chapters 04, 05, and 12.

**1. One synthetic harbor, not two.** Coordination-Bench (Phase 3) is *the
implementation vehicle* for the binder's "Simulation sandbox"
(ch. 05) and the scoring half of the C7 evaluation/simulation chain (ch. 12).
No second sandbox gets built. The bench splits into **3a** (bench-v1, today's
hazards and vocabulary, unchanged from the original matrix row) and **3b**
(bench-v2, the binder's larger apparatus) — see the amended Implementation
Matrix.

**2. Episode schema rides the transcript event schema.** Chapter 04 declares
transcripts the foundational substrate with a canonical event schema in
ch. 09 (visibility class, redaction state, parent-event ids, hashes). The
Episode JSONL of Phase 0 must be a *join over that event schema plus the
coordination tables*, not a parallel event shape — and must carry a schema
version field with declared extension points for the Milestone-8 coordination
vocabulary (parley events, blackboard writes, sanctions/reputation ledger
events). Rationale: SFT freezes the action grammar into weights; the corpus
must survive vocabulary growth or early episodes become waste.

**3. Rubric v2 backlog.** The binder's sandbox scoring list (ch. 05) and the
incentive model contribute terms absent from `coordination-reward/v1`:
operator interruptions, context waste (computable once ch. 04
context-pressure envelopes ship), transcript completeness,
time-to-recover-from-failure, handoff quality, early-parley credit,
ignored-parley penalty, and cleanup escrow for risky autonomous actions.
These are registered here as the `coordination-reward/v2` backlog; v1 ships
as specified.

**4. Defection pricing is a bench deliverable.** The binder's incentive model
requires that "bypassing claims is measurably more expensive than
cooperating." Bench-v2 therefore reports a price-of-defection metric per
scenario class, not only cooperative-episode scores.

**5. Phase 4 inherits skill governance.** Evolved prompts and choreography are
transcript-derived artifacts; ch. 04's proposal-vs-validation separation and
quarantine apply before any evolved scaffold is admitted. This gives the
Goodhart audit an enforcement mechanism.

**6. Phase 5 trains a Longshoreman.** The binder names the role the tuned
small model fills: a Longshoreman body (conflict watcher, salvage shepherd,
inbox/parley duty, compaction author, dispatcher). The first training target
is **compaction-packet authorship** — ch. 04 defines the packet as a
first-class event with a citation-checking validator, which is a ready-made
verifiable reward. Corpus-at-scale is gated on the Milestone-8 tool grammar.

**7. Data governance tightens.** Training-data curation is **explicitly
opt-in** (ch. 04), stricter than redact-by-default; and the distilled-source
contract applies transitively: if raw transcript payloads are deleted,
episodes and any SFT rows derived from them must cite tombstones and degrade
honestly rather than pretend the source exists.
