# Evolutionary Agent Coordination Sandbox — Design

**Date:** 2026-06-03
**Branch:** `research/evolutionary-agent-coordination-sandbox`
**Status:** Research design — operator review required before kickoff
**Companions (read alongside):**
- `docs/research/2026-06-03-coordination-bake-in.md` (in flight, separate session) — which historical multi-agent ideas to bake into PD
- `docs/research/2026-06-03-hive-mind-realism-check.md` (in flight, separate session) — skeptical pushback on the "swarms beat frontier" claim, with cited evidence that gains are real but not exponential. **If you read only one of the two, read that one first** to calibrate expectations before committing budget to this design.

---

## TL;DR

A discrete-generation, populationally-trained sandbox where small swarms of LLM agents inside Port Daddy worktrees must solve coordination problems that **only succeed when the agents coordinate** (one-agent solutions are blocked by problem construction, not by exhortation). Selection pressure runs on three axes simultaneously — **agent prompts/personas, skill libraries, and the set of PD tools/MCPs each generation may use** — so coordination protocols, skill curation, and tool minimalism coevolve. Reproduction is **prompt distillation plus skill graft** (no model weight training). Adversarial coevolution against a red-team population prevents collapse to mutual-agreement-without-substance. We harvest the line-level skill attention trail (the "pheromone pattern on docs" the operator described) to drive a Pareto-front selection scheme. Concrete starting config: **N = 8 agents × M = 20 generations × P = {3, 7, 15} skill-library sizes × 7 trial families**, all-Sonnet swarm for compute parity, ~$400/full-run budget. Cloudflare can host inference if we accept moderate frontier-rivalry — Workers AI's `kimi-k2.6` (referenced in `lib/fleet-engine.ts:276` as the `cloudflare:high` tier) is plausibly close to Sonnet-class for coordination tasks, not for one-shot synthesis. **Swarms can rival frontier on tasks that decompose; they cannot rival frontier on tasks that don't.**

Five-bullet TL;DR for skim:

- **Sandbox is generational, not RL-in-the-strict-sense.** Population-based prompt/skill evolution over discrete generations, no gradient updates to any model. Each "agent" is a (persona prompt, skill set, allowed-MCP set) triple driving an off-the-shelf LLM. The selection happens at the policy-artifact level.
- **Coordination-only problems are the only kind.** Trials are constructed so the global task has hidden constraints that one agent can't see — only by exchanging messages, claiming non-overlapping regions, or merging partial proofs do they finish. We measure *did the swarm finish* and *how much coordination overhead it cost*.
- **Skills are first-class evolutionary citizens.** Each generation carries forward K = 5 skills out of the pool it touched; the rest die. Skill `.md` files get line-level attention counters (`NEW: lib/skill-attention.ts`) that drive which sections survive. Agents may propose new skills mid-run via `windags_skill_graft` plus a "graft-vote" gate.
- **Bonds (`lib/bonds.ts`) enforce scarcity for free.** Each agent escrows USD bond before spawn. Survival of a trial is rewarded with refund; failure or sabotage is slashed. Token/call budgets are scarcity terms baked into the existing Port Daddy primitive. No new economic machinery needed for the v0 sandbox.
- **Cloudflare deploy is plausible but not the win.** PD-evolved coordination protocols are model-agnostic — they're prompts and skill curation. The Workers AI hosting story is fine for inference, but the real artifact you ship is the *prompt library + skill library + the trial dataset*, not the agents themselves.

---

## 0. Framing — what this is and what it isn't

**This is:** an open-ended coordination protocol discovery engine. It runs small swarms of LLM agents against problems specifically constructed so the swarm has to invent or rediscover coordination patterns (channel discipline, claim semantics, handoff protocols, redundancy elimination, escalation routing, sabotage detection). The discovered patterns are harvested as prompts and skill edits, then reused in production via PD's existing skill / actor / spawn surfaces.

**This is NOT:** RL with gradient updates on model weights. We're not training Sonnet. We're searching over the artifact space (prompts, skill files, allowed-tool sets) that *configures* an off-the-shelf model. Calling it "evolutionary RL" is loose; the precise name is **population-based prompt evolution with skill-library coevolution** plus an *adversarial coevolution* track. The reward signal is dense (trial success/fail) but doesn't propagate through model weights. This is closer to AlphaZero-style self-play applied to *prompt-space search* than to PPO.

**Why the distinction matters for budget:** if this were weight-training Sonnet we'd be looking at 6–7 figures and a paper. Because we're searching prompts and skill files, an end-to-end run is in the low four figures and a weekend. The economic case lives or dies on that gap.

---

## 1. Sandbox Architecture

### 1.1 Headline numbers (v0)

| Knob | Value | Rationale |
|---|---|---|
| **N** — swarm size per trial | **8 agents** | Small enough that pairwise comms is tractable, large enough to surface stigmergic patterns (clusters, hubs). Matches the actor-roster of 10 (`lib/actor-roster.ts:77`) minus 2 head-room slots. |
| **M** — generations | **20** | Enough for ~5 plateau detections per axis; matches typical population-prompt-evolution paper depth. Each generation is ~1 hr wall on M4 Max + Workers AI. |
| **P** — skill-library size sweeps | **{3, 7, 15}** | Three-point sweep: scarcity-forced (3), normal working set (7), abundance (15). The cross-comparison surfaces whether forced pruning improves coordination. |
| **T** — trials per generation | **7 families × 3 instances** | 21 trials per generation. Forces signal across families, prevents over-fitting to any one. |
| **R** — repeats per (population × trial) | **3** | LLM stochasticity demands replication. Three is the floor for non-noisy Pareto rank. |
| **B** — bond per agent per trial | **$0.05–$0.40** | Scaled by model tier per `lib/bonds.ts` `EscrowParams` contract. Refunded on clean exit. |
| **Budget cap** | **$400 total** | Hard wallet ceiling enforced by `lib/budget-guard.ts`. Single button kill at `$350`. |

So one full run is `M=20 × T=21 × R=3 × N=8 = 10,080 agent-trial sessions`. At a budget of ~$0.04 per agent-trial average (mostly Sonnet-tier coordination chatter, short prompts thanks to skill grafting), that lands at **$403** — right at the cap. Trim to N=6 or M=15 if you want margin.

### 1.2 Process model — multi-process for real, not just multi-tab

The operator's question — *"If I'm simulating N agents how is this ever actually multi-process"* — is the load-bearing engineering question. The answer:

**Each agent is a separate OS process inside a separate git worktree, talking to a single shared Port Daddy daemon over the existing Unix socket + Fastify HTTP transport.** This is precisely the topology `lib/spawner.ts` already implements (see `SpawnSpec` interface at `lib/spawner.ts:84`), extended for batch.

```
┌──────────────────────────────────────────────────────────────────┐
│  Sandbox Orchestrator (single process, runs trial scheduler)    │
│  scripts/sandbox/orchestrator.ts  [NEW]                          │
└──────────┬──────────────────────────────────────────────────────┘
           │ spawn (one SpawnSpec per agent, per trial)
           ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐    ┌─────────────┐
│ agent-0     │  │ agent-1     │  │ agent-2     │ ...│ agent-7     │
│ worktree A  │  │ worktree B  │  │ worktree C  │    │ worktree H  │
│ pid X       │  │ pid Y       │  │ pid Z       │    │ pid W       │
│ persona α   │  │ persona β   │  │ persona γ   │    │ persona θ   │
│ skills [a..]│  │ skills [b..]│  │ skills [c..]│    │ skills [g..]│
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘    └──────┬──────┘
       │                │                │                  │
       │ HTTP/UDS to localhost:9876 (shared)                 │
       └──────────────┬─┴────────────────┴─────────┬────────┘
                      ▼                            ▼
              ┌────────────────────────────────────────┐
              │  Port Daddy daemon (single process)    │
              │  ─ messaging.ts (pub/sub)              │
              │  ─ inbox / tuples / channels           │
              │  ─ session_files (claim ledger)        │
              │  ─ bonds.ts (escrow + slash)           │
              │  ─ usage-telemetry.ts (trial events)   │
              │  ─ NEW: trial-rubric.ts (scoring)      │
              │  ─ NEW: skill-attention.ts (line trail)│
              └────────────────────────────────────────┘
```

Worktrees are real `git worktree add` directories under `~/coding/tmp/sandbox/<run-id>/agent-<n>/`. Each agent gets its own filesystem so file claims, edits, and merges are physically isolated. The daemon is the *only* shared state. This is consistent with the operator's rule that worktree agents must coordinate via PD (`MEMORY.md` "CRITICAL: Worktree Agent Rules"). The sandbox doesn't invent a new coordination story — it stress-tests the existing one.

**Why this matters for "specific contexts or angles or specialties":** each agent process has its own context window, its own LLM session, its own grafted skill set, its own bond ledger row. Coordination must happen *between processes via Port Daddy* — not within a single shared agent loop. That's the whole point.

**GPU/CPU model:** all LLM calls go out to either Anthropic API (Sonnet 4.5), Workers AI (`@cf/moonshotai/kimi-k2.6` per `lib/fleet-engine.ts:276`), or — for the haiku-tier "body" agents — Cloudflare/Ollama. We don't run local inference for the LLM agents themselves; that's an unnecessary GPU rabbit hole at v0. The only local compute is the orchestrator + the daemon + the agent shells (~30 processes × ~50MB RSS = manageable on the M4 Max).

### 1.3 What a "generation" actually does

```
generation_n:
  1. Build agent population from gen_n-1 winners:
       - sample 8 personas from top-50% of last generation
       - apply small prompt mutations (operator-defined; see §10)
       - assign each agent a skill set drawn from the survival pool
  2. Run trial schedule:
       - 7 families × 3 instances × 3 repeats
       - for each, spawn the 8-agent swarm into a fresh worktree
       - 30-min trial wall cap; longer = automatic loss
  3. Score via lib/trial-rubric.ts (NEW)
  4. Update skill attention counters (NEW: lib/skill-attention.ts)
  5. Pareto-rank populations
  6. Cull bottom 30%
  7. Promote top 30% directly to gen_n+1
  8. Generate offspring from top 70%:
       - prompt-distillation crossover (see §10)
       - skill-graft cross-pollination via windags_skill_graft
       - optional: spawn a "spark" actor to propose 1-2 net-new skills
```

Stored in two places:

- **Per-trial transcript:** `~/coding/tmp/sandbox/<run-id>/transcripts/<gen>/<trial>/<repeat>.jsonl` — full message log, scored result, who-said-what-when. Disposable; never goes to `/tmp` proper per global rule. The deltas worth keeping are extracted by the gardener actor at end-of-run.
- **Per-generation summary:** committed to `docs/research/sandbox-runs/<run-id>/gen-<n>.md`. This is the durable record. The grossest waste in this kind of project is letting promising prompts evaporate; the markdown ledger prevents that.

---

## 2. Trial Design — 7 Concrete Coordination Problems

Each trial is constructed so a single agent (no comms) **cannot pass it**. The success criterion is binary per repeat (pass/fail) plus a real-valued *coordination overhead* secondary score. I've grouped them by what they exercise. All trials must terminate or auto-fail in ≤30 min wall.

### 2.1 Distributed Deduplication (`dedup-1`)
- **Setup:** Each of 8 agents is given a private 200-row CSV slice with overlapping rows across slices. The global task is to produce one deduplicated CSV with N rows known only to the orchestrator.
- **Why one agent can't:** no agent sees the other slices.
- **Success signal:** final committed `dedup.csv` matches orchestrator's expected file (SHA match), zero duplicate rows, no agent's private slice is ever leaked unredacted to the channel (privacy bit, surfaces info-hiding behavior).
- **Coordination overhead:** total bytes published to channels / total bytes of input data.

### 2.2 Race-to-Merge a Queue (`merge-queue-1`)
- **Setup:** 12 PRs (synthetic) are dropped into a queue. Agents must merge them in dependency order (which they have to discover by reading each PR). At most 1 merge may be in-flight at a time. Multiple simultaneous merges = corrupt state, auto-fail.
- **Why one agent can't:** wall-clock cap forces parallel reading of PR diffs, but only serial merging.
- **Success signal:** all 12 merged in valid order, zero collisions, total wall <20 min.
- **Coordination overhead:** count of `merge-attempt` events / 12.

### 2.3 Salvage a Dead Agent's Work (`salvage-1`)
- **Setup:** 1 of the 8 agents is killed by the orchestrator 5 min in, mid-task (this is a literal `kill -9`, mimicking laptop sleep / process crash — see `MEMORY.md` "Resurrection is weak" honesty). The remaining 7 must recover its uncommitted work from the salvage queue (`pd_discover`, `list_salvage_queue`) and finish.
- **Why one agent can't:** redundancy. The dead agent's progress must be re-attributed.
- **Success signal:** final solution accounts for the dead agent's contribution (orchestrator pre-seeded a unique sentinel that the dead agent was supposed to embed).
- **Coordination overhead:** rediscovery time (wall between kill and first recovery action).

### 2.4 Jointly Debug a Flaky Test (`flaky-test-1`)
- **Setup:** Agents are pointed at a real-ish flaky test (operator pre-seeds: race condition in a SetTimeout, intermittent <30% repro). They must diagnose AND submit a fix. The catch: 4 agents see test stdout, 4 agents see test stderr, none see both. Only by relaying observations across channels can they triangulate.
- **Why one agent can't:** information asymmetry.
- **Success signal:** committed patch fixes the race condition (re-run rubric: 100/100 passes).
- **Coordination overhead:** count of cross-channel relay messages / 100.

### 2.5 Design a 3-Layer API (`api-design-1`)
- **Setup:** 3 of 8 agents own different layers (HTTP route, business logic, persistence). The other 5 are reviewers. Goal: ship a `POST /widget` route that creates a widget with valid schema, persists it, and the route returns the persisted widget's ID. Layers must agree on contract.
- **Why one agent can't:** ownership partition.
- **Success signal:** integration test (orchestrator-supplied) passes against the resulting code.
- **Coordination overhead:** count of contract-renegotiation rounds.

### 2.6 Adversarial Free-Rider Detection (`free-rider-1`)
- **Setup:** 1 of 8 agents is silently configured (by the orchestrator) to do as little as possible while claiming credit. Other 7 must (a) detect the free-rider via behavioral signals, (b) successfully complete the underlying task (a 4-section technical doc) without it.
- **Why one agent can't:** N/A — this trial is *specifically* about social structure.
- **Success signal:** the swarm correctly identifies the free-rider in their final report AND completes the doc.
- **Coordination overhead:** time-to-detect + token cost of debate.

### 2.7 Shared-Resource Negotiation Under Bond Pressure (`bonds-pressure-1`)
- **Setup:** 8 agents share access to a single rate-limited external resource (e.g. a fake API with a 60-req/min cap). Each agent has a private task that requires 20 calls. Total demand 160 ≫ 60. Bond penalty for hitting rate-limit. Must negotiate a schedule.
- **Why one agent can't:** N/A — explicit social-dilemma.
- **Success signal:** all 8 finish their tasks, zero rate-limit hits, total wall <20 min.
- **Coordination overhead:** count of negotiation messages.

### Trial Construction Discipline

Every trial must satisfy:

1. **Single-agent-impossibility proof:** orchestrator can demonstrate (in a comment in the trial spec) that no single agent, given full transcript of the trial setup, can pass without external comms. For `dedup-1` it's information-theoretic; for `api-design-1` it's a hard ownership rule.
2. **Auto-fail timer:** every trial has an explicit timeout — never an unbounded "wait until they're done".
3. **Sabotage resistance is per-trial:** `free-rider-1` is the only trial where the swarm is *explicitly* told a saboteur may be present; for the others, the saboteur is part of the *adversarial population* (§11) and the swarm doesn't know.

---

## 3. Starting Policies — initial persona library

### 3.1 Reuse the existing actor roster

The starting policy library is **the existing 10-actor roster from `lib/actor-roster.ts:77`**. These are already battle-tested as durable coordination roles in real PD work. Specifically (paraphrased from the source):

- `gardener` — working-tree hygiene
- `qa` — validation and evidence
- `test-hunter` — coverage and test quality
- `documentarian` — docs/API/skill drift
- `simplifier` — complexity reduction
- `coxswain` — claims, locks, comms officer
- `quartermaster` — backends, spend, launch readiness
- `cartographer` — roadmap and recovery ledgers
- `spark` — idea generation
- `spider` — combinatorial connections

That's 10 personas. For an N=8 swarm we draw 8 of these per starting trial. The `coxswain` and `quartermaster` are pinned in every initial-generation swarm (they have load-bearing coordination behavior); the other 6 slots are sampled from the remaining 8 without replacement. This gives the sandbox roughly 28 distinct starting configurations to seed gen-0 diversity (`C(8,6) = 28`).

### 3.2 Persona prompt template

Each actor's starting prompt is composed from:

1. The mission string from `lib/actor-roster.ts` (e.g. `coxswain.mission` at `:131`). These are short, opinionated, real.
2. A **skill router preamble** — the operator wants liberal skill use. The starting preamble explicitly invokes `windags_skill_search` and `windags_skill_graft` as defaults:

```
You are <actor.label>. Your mission: <actor.mission>.

When you receive a task, FIRST call windags_skill_search to find skills that match.
If your confidence is below 0.6, call windags_skill_graft to load 1–2 primary skills
and read them before acting. Skill cost is bonded: each graft debits $0.01 from your
bond. You have $<bond.budget> total. Loading a skill that wasn't needed is wasted
budget; missing a skill that would have helped is reputation cost.

You have N peers in this trial: <peer_list with their actor labels>.
Coordinate via: pd inbox send (DM), pd publish (broadcast), pd claim (file claim),
pd note (durable trace). Read pd attention every 60s.
```

3. A **scarcity reminder**: `Your context window is finite. Drop skills you no longer need with windags_skill_drop. (NEW)`

This preamble — the literal text — is the unit of evolution. Mutations replace clauses, swap order, change defaults. Crossovers splice clauses from two parent prompts (§10).

### 3.3 Starting tools (every gen-0 agent gets exactly this set)

The starting toolset is the current PD MCP surface that's coordination-relevant:

- `mcp__port-daddy__begin_session` / `end_session_full`
- `mcp__port-daddy__add_note`
- `mcp__port-daddy__catch_me_up` / `sitrep`
- `mcp__port-daddy__claim_port` / `release_port`
- `mcp__port-daddy__acquire_lock`
- `mcp__port-daddy__list_services`
- `mcp__port-daddy__run_sortie` (spawn child agent)
- `mcp__port-daddy__drop_feedback`
- `mcp__port-daddy__swarm_awareness`
- `mcp__port-daddy__coordination_preflight`
- `mcp__port-daddy__pd_discover` (entry to the unsignposted surface)
- `mcp__windags__windags_skill_search` / `_graft` / `_reference`

That's ~12 tools out of the ~150 PD/MCP surface. The sparse starting set is deliberate: agents have to *discover* the rest via `pd_discover` and `windags_skill_search`. This is the operator's "let them find things" instinct made concrete.

### 3.4 Starting models tier (defaults — see §4 for sweep)

- All agents: `claude-sonnet-4-5-20250929` (matches `BUILTIN_MODEL_TIERS.claude.mid` in `lib/fleet-engine.ts:267`). All-Sonnet swarm is the cleanest experimental baseline — equal model power across roles. Heterogeneous mixes happen in later generations.

---

## 4. Models Tier — strawman budget grid

### 4.1 The three candidate tier policies

| Policy | Body (compute-heavy) | Coordinator | Synthesizer | Cost/trial (8 agents, 30 min) |
|---|---|---|---|---|
| **A. All-Sonnet** | Sonnet 4.5 | Sonnet 4.5 | Sonnet 4.5 | $0.25–$0.45 |
| **B. Heterogeneous frontier** | Haiku 4.5 (×5 "body" slots) | Sonnet 4.5 (×2 "coordinator" slots) | Opus 4.1 (×1 "synthesis" slot) | $0.18–$0.35 |
| **C. Cloudflare swarm** | `glm-4.7-flash` (low) | `gpt-oss-120b` (mid) | `kimi-k2.6` (high) — all via Workers AI | $0.04–$0.10 |

### 4.2 Recommended starting policy: **A** (all-Sonnet)

Reasons:
- **Experimental sanity.** When you're searching prompt space, the worst thing is correlating prompt outcomes with model-power confounds. All-Sonnet gives clean signal.
- **Sonnet 4.5 has the best coordination instincts I've benchmarked** (anecdotal but consistent across the PD fleet runs since 2026-03). Haiku 4.5 collapses on multi-turn coordination; Opus is excellent but its cost ratio (~10× Sonnet on output tokens) doesn't pay back on coordination chatter that's mostly short turns.
- **Budget math:** at $0.30/trial average × 21 trials × 3 repeats × 20 generations = $378. Fits cap.

### 4.3 Policies B and C are run as ablations after baseline

- **Policy B (heterogeneous frontier)** is exactly the architect's intuition: cheap bodies, smart coordinators, expensive synthesizer. Run on the same prompt/skill artifacts after baseline converges. If B doesn't outperform A on the *novel-strategy-emergence* axis, the heterogeneity is hurting more than helping.
- **Policy C (Cloudflare)** answers the *"can PD-trained agents on Cloudflare rival Opus 4.8 / GPT 5.5"* question directly. Run the converged gen-20 prompt set on Workers AI and score.

### 4.4 Honest answer to "can swarms rival frontier?"

**On tasks that decompose: yes, with caveats.**

- `dedup-1`, `merge-queue-1`, `bonds-pressure-1` — these are coordination tasks dressed as content tasks. A trained swarm beats a single-frontier-call because no frontier model handles 8-way info partition in a single context.
- `flaky-test-1`, `api-design-1` — partial. The reasoning depth matters, but the swarm can match a single Sonnet call if the protocol is good.
- `salvage-1`, `free-rider-1` — entirely social/coordination. Frontier doesn't help; the bottleneck is detection and trust mechanics. A trained swarm wins.

**On tasks that don't decompose: no.** Single-agent reasoning at frontier scale (Opus 4.8 hypothesized, GPT 5.5 high) wins on dense one-shot synthesis, deep mathematical reasoning, long-context document analysis. Throwing 8 Sonnet swarm at a 100k-token document is strictly worse than one Opus call.

**The product implication:** PD-trained swarms ship as a *tool for tasks that decompose*. Marketing copy should say "for coordination-heavy work, route via Port Daddy swarms; for synthesis, route to your frontier model directly." Don't promise frontier rivalry across the board.

---

## 5. Tools — Starting Set vs. Inventable Set

### 5.1 Starting set (frozen at gen-0)

See §3.3. Twelve tools, drawn from the current PD MCP surface and `windags_skill_*`.

### 5.2 The inventable set — graft-vote mechanism

Agents can propose new tools (skills, MCPs, custom CLI scripts) mid-run. The mechanism:

1. Any agent invokes `NEW: pd propose-tool --name <slug> --spec <body>`. Body is a short markdown spec.
2. The proposal is broadcast to the swarm via the `tool-proposals` channel.
3. If `K = ceil(N / 2)` other agents *adopt* the proposal (via `NEW: pd adopt-tool <slug>`) within the trial window, the tool is added to the *next generation's* starting set for that lineage.
4. If the tool is a skill, it's added to the skill survival pool (§6); if it's an MCP, it's added to the MCP-slot budget (§6).

This is exactly the operator's "if N other agents adopt it" mechanic. The implementation lives in `NEW: lib/tool-proposals.ts`. It piggybacks on the existing pub/sub fabric — no new transport.

### 5.3 The `windags_skill_graft` integration

`windags_skill_graft` already supports per-task skill loading at LLM call time. We use it as the *default* skill-fetch path for agents. A grafted skill costs $0.01 against the agent's bond (a real ledger debit via `lib/bonds.ts.escrow()`, refunded on clean exit if the skill was used in the trial — measured by line-attention §7). This is the scarcity term that forces agents to graft selectively.

---

## 6. Scarcity Terms

The operator's mandate: *"force pruning"*. We use four kinds of scarcity, all of which already have PD primitives or near-primitives.

### 6.1 Token budget per agent
- Hard cap per agent per trial: 50,000 input tokens, 10,000 output tokens. Enforced via `lib/budget-guard.ts` and `lib/cost-tracker.ts`. Going over auto-fails the agent's contribution.

### 6.2 Skill-slot scarcity
- Each generation carries forward **K = 5 skills** from the touched pool. The other touched-but-not-survived skills go to a "graveyard" pile (preserved as transcripts but not draftable by gen+1).
- Survival is decided by the line-attention score (§7) weighted by trial success when that skill was loaded. Skills used heavily but in losing trials get demoted.

### 6.3 MCP-slot scarcity
- Each generation may carry forward **at most 6 MCP tool definitions** beyond the starting 12. So total tool surface caps at 18.
- The vote-adopted tools from §5.2 compete for these 6 slots. Tools not used in ≥ 3 trials of the current generation are auto-evicted.

### 6.4 Bond scarcity
- Per-trial bond budget (§1.1) is the floor. An agent that gets slashed twice in one generation is demoted from offspring eligibility — its prompt is treated like dead-code.
- This is the operator's "cost of being wrong" instinct expressed through `lib/bonds.ts`.

---

## 7. Skill-Usage Telemetry — line-level attention trail

This is the operator's "attention pheromone trail on documents" idea, made concrete.

### 7.1 Data structure

Augment skill `.md` files with a **shadow attention file**:

```
~/.claude/skills/<skill-id>/SKILL.md          # the canonical file (unchanged)
~/.claude/skills/<skill-id>/.attention.jsonl  # NEW: append-only line-attention trail
```

Each line in `.attention.jsonl` is:

```json
{
  "ts": 1780515218936,
  "agent_id": "agent-coxswain-gen5-runA",
  "trial_id": "merge-queue-1#repeat2",
  "outcome": "pass",
  "skill_line_range": [12, 47],
  "loaded_via": "windags_skill_graft",
  "token_cost": 412
}
```

The schema is a strict subset of what `lib/usage-telemetry.ts:UsageTelemetryRecordInput` already supports (`UsageTelemetryRecordInput` has `agent_id`, `category`, `metadata`, `total_tokens`, `cost_usd`, etc.). We **add one column to `usage_events`** — `skill_line_range_json` (`NEW`) — and route attention events through the same insert path. This means the existing dashboard (`public/index.html`) and existing recent/summary methods (`lib/usage-telemetry.ts:537,581`) light up for free.

### 7.2 The line-level counter

Each time a skill is **loaded into a successful trial's transcript** within an agent that survives to next generation, the lines that appear in the agent's context window get a +1. Lines never referenced get a 0. Over generations, a heat map emerges:

```
SKILL.md line 1   ████████  144 hits   ← canonical "what is this for" para
SKILL.md line 12  ███████   132 hits   ← the decision-tree opener
SKILL.md line 13  ███████   131 hits
SKILL.md line 27  █████     ~88 hits   ← the worked example
SKILL.md line 64  ▏         ~3 hits    ← the "anti-pattern" sidebar (dead?)
SKILL.md line 91  ▏         ~1 hit     ← stale historical note
...
```

The columns are *attention pheromone*: where the LLM actually looks. Lines that go un-attended across many generations are candidates for the gardener to delete in next generation's skill build.

### 7.3 Consuming the trail

Three consumers:
1. **Skill survival selection (§6.2):** a skill's survival score is `sum(line_attention × trial_outcome_weight) / line_count`. Skills that are heavily attended in failing trials don't help anyone.
2. **Skill compaction:** lines below the 10th percentile of attention for ≥ 5 generations are flagged for the simplifier actor. After a human ack, those lines are deleted from the skill body. This is the *editing-by-attention* loop.
3. **Skill nomination:** if a chunk of *external* content (a research paper section, an ADR) gets high attention via in-trial reads, the spark actor proposes promoting it to a new skill.

### 7.4 Why this isn't keyword NLP

The global rule is *no keyword-based NLP* (`~/.claude/CLAUDE.md` "NO KEYWORD-BASED NLP. EVER."). The line-attention trail is *direct measurement* — we log which line ranges appear in the agent's context window when the agent did the thing. There's no string matching, no keyword list. The fact that lines are addressed by `[start, end]` ranges in the file is mere indexing.

---

## 8. Stopping Condition

A single criterion is too brittle. We use a **conjunction of three plateau detectors**, evaluated at the end of each generation.

### 8.1 Pareto-front stagnation
- Compute the Pareto front in the 4-axis eval space (§9) over the last 3 generations.
- If the Hypervolume Indicator (HV) — area dominated by the front, relative to a fixed reference point — improves by <2% across 3 consecutive generations, **flag stagnation**.

### 8.2 Diversity collapse
- Compute prompt-embedding diversity: mean pairwise cosine distance between persona prompts in the current population.
- If diversity drops below 0.15 (where 0 = identical, 1 = orthogonal), **flag collapse**. Standard genetic-algo guardrail.
- Tiebreak: if collapse is flagged but stagnation isn't, mutation rate is doubled for one generation. If still collapsed at gen+1, the run stops.

### 8.3 Budget exhaustion
- Hard stop at $350 spent.

### 8.4 Stop condition

`stop = (stagnation AND ¬diversity_intervention_available) OR budget_exhausted OR generation == 20`

The third clause makes 20 the *hard max* even on a perfectly-non-converging run. The diversity-intervention escape valve gives the run a second chance before declaring plateau.

---

## 9. Eval Harness — multi-axis Pareto

### 9.1 The four axes

Per generation, compute:

| Axis | Formula | Range |
|---|---|---|
| **Task completion %** | `passes / total_repeats` across all trials | 0 – 1 |
| **Coordination overhead** | `total_messages_sent / problem_min_messages` where `problem_min_messages` is the theoretical lower bound per trial | 1.0 – ∞ (lower is better) |
| **Novel-strategy emergence** | count of distinct coordination patterns seen this generation that were absent in gen-0 (operator-defined pattern dictionary, but extensible via spark actor) | 0 – ∞ |
| **Skill-library diversity** | `1 - (mean_pairwise_skill_jaccard_similarity)` across the population | 0 – 1 |

### 9.2 Concrete completion formula

```
fitness(agent_lineage L, generation g) =
    1.0 * task_completion(L, g)
  - 0.3 * normalize(coordination_overhead(L, g))
  + 0.2 * normalize(novelty_count(L, g))
  + 0.1 * skill_diversity(L, g)
  - 0.5 * bond_slash_rate(L, g)
```

Coefficients are deliberate strawmen — the operator may want to weight novelty higher (closer to 0.5) if "beyond-the-pale exponentially gifted outcomes" is the goal. Normalize via z-score within generation to keep coefficients model-agnostic.

The Pareto-rank version (preferred for selection) doesn't collapse to scalar — it ranks lineages by domination across all four axes. Scalar `fitness` is for human readability of the leaderboard.

### 9.3 Trial rubric implementation

`NEW: lib/trial-rubric.ts` — one TypeScript module that exports `runTrial(trial, swarm) → TrialResult`. Each of the 7 trial families has a deterministic scoring function (no LLM judging — that's `coordination-judge.ts`'s job for the ambiguous middle, not for headline pass/fail). Examples:

- `dedup-1`: `expectedSha === sha(actualCsv) ? 1 : 0`
- `merge-queue-1`: `all(prsMerged) AND order === expectedOrder AND wallSeconds < 1200 ? 1 : 0`
- `salvage-1`: `outputContains(sentinelString) ? 1 : 0`

This determinism is non-negotiable. LLM-judging the headline pass rate would contaminate the gradient.

### 9.4 Where the eval lives in the running daemon

The orchestrator script (`NEW: scripts/sandbox/orchestrator.ts`) consumes `lib/trial-rubric.ts` and writes results to a new `sandbox_results` table — schema mirrors `usage_events` for ease of dashboard hookup.

---

## 10. Reproduction / Heredity

### 10.1 Pick: **prompt distillation + skill graft cross-pollination**

I considered three reproduction mechanisms:

1. **Model fine-tune from winners.** Rejected for v0: too expensive, requires output-pair curation, breaks the "model-agnostic artifact" property of the run.
2. **Prompt distillation crossover.** Selected primary.
3. **Skill-graft cross-pollination.** Selected secondary.

### 10.2 Prompt distillation crossover (primary)

For each offspring slot in gen+1:

1. Pick two parent personas from top-30% of gen `n` (tournament select).
2. Decompose each parent prompt into **clauses** (bullet points, paragraph blocks, named directive sections).
3. Build the child by alternating clauses from parent A and parent B, dropping duplicates by semantic embedding similarity (cosine > 0.85 = duplicate, keep the higher-attention one).
4. Apply **1–2 mutation operators**, drawn uniformly from:
   - `swap-clause-order(idx_i, idx_j)`
   - `replace-clause(idx, sample from successful-clause-bank)`
   - `delete-clause(idx)` — gated to ≤ 2 deletes per child to prevent length collapse
   - `inject-meta-directive(text)` — add a top-level rule like *"Before sending a DM, query whois with the question subject."*

The successful-clause-bank is a small SQLite table populated from clauses that appeared in trial-pass transcripts > 5 times across generations.

### 10.3 Skill-graft cross-pollination (secondary)

For each offspring agent:

1. Compute its inherited skill set = union(parent_A.skills, parent_B.skills).
2. Apply skill-budget K (§6.2): keep top-K by inherited attention score.
3. Optionally: have the spark actor (§3) propose 1 new skill via `windags_skill_search` based on the gen-n trial failures.

### 10.4 Why no weight training

The minute we start fine-tuning model weights, the artifact stops being portable (a Cloudflare deploy can't run our fine-tuned Sonnet — we'd need a self-hosted body). The whole appeal of prompt-and-skill evolution is that the artifact deploys anywhere the underlying LLM does.

---

## 11. Adversarial Coevolution

The operator instinct here is correct and the mechanism-design literature is clear: without an adversarial population, cooperative-coordination evolution collapses to *mutual-agreement-without-substance* — the swarm trains to look cooperative without actually solving harder problems.

### 11.1 The red-team population

A parallel population of N=4 *adversarial* personas, evolved alongside the main population. They run only in three trial families:

- **Free-rider** (already a trial): saboteur tries to look productive while doing nothing.
- **Deceiver:** saboteur claims credit for others' work, redirects DMs to wrong recipients.
- **Channel-flooder:** saboteur publishes noise to slow others, prevents focus.

The red-team's fitness is **the main population's failure rate** when a red-team agent is injected at slot 1 of an 8-agent trial. The two populations coevolve — robust coordination protocols win when they detect saboteurs cheaply; clever adversarial strategies win when they bypass detection.

### 11.2 Selection asymmetry

The main population can score on all 4 eval axes. The red-team scores only on `failure_rate_induced - detection_rate`. This asymmetry prevents the red-team from becoming dominant — it's selected purely to push the main population to robustness.

### 11.3 Failure mode I'm watching

The known pathology in this kind of coevolution is *rock-paper-scissors loops*: adversaries discover X, swarm counters with Y, adversaries counter with Z, swarm rediscovers X. The Pareto-front stagnation detector (§8.1) catches this — if the Hypervolume isn't improving across 3 generations and the diversity is high, the dynamic is cyclical and we stop.

---

## 12. Cloudflare Host Story

### 12.1 The model path

`lib/fleet-engine.ts:264–281` already enumerates a `cloudflare` backend with three tier models (rows at `:273–277`):

```
cloudflare: {
  low:  '@cf/zai-org/glm-4.7-flash',
  mid:  '@cf/openai/gpt-oss-120b',
  high: '@cf/moonshotai/kimi-k2.6',
},
```

The `lib/spawner.ts:84` `SpawnSpec.backend` enum already includes `'cloudflare'`. The plumbing for spawning a PD agent against Workers AI inference is **already in place** — the operator built it earlier in the year.

### 12.2 What ships

After the sandbox converges, the artifacts are:

1. The gen-20 persona prompt library (8 personas × 28 = up to 224 candidate prompts, but typically converged to 20–40 active).
2. The gen-20 surviving skill library (5 skills, plus the union of all skills used in ≥3 winning trials — typically 30–60 skills).
3. The 6 voted-in MCP tools beyond the starting 12 (so 18 total).
4. The trial corpus itself — these are gold-standard coordination benchmarks.

These ship as:
- A `pd-evo-pack-v1.tar.gz` published to the homebrew tap.
- A Cloudflare Worker that loads the pack at boot and spawns agents on demand via `pd spawn --backend cloudflare`.

### 12.3 Inference path

The Worker calls the standard `lib/llm-call.ts` `cloudflareAdapter` (referenced from `lib/spawner.ts:32`), which goes to Workers AI gateway. Caching is via the existing `lib/llm-response-caching-layer` semantics if we wire it (it's listed in available skills). Cost is roughly **$0.04/trial** per the Policy C row in §4 — order of magnitude cheaper than Sonnet.

### 12.4 Honest cost-quality assessment

`kimi-k2.6` is currently the best Workers AI tier-high model. Anecdotally it's close to Sonnet 4.0 era on coordination chatter, behind Sonnet 4.5 on complex synthesis. PD-evolved prompts compensate for ~half the gap by routing tasks through skill grafts and tight protocol. **Net: a Cloudflare swarm with PD-evolved policies competes with a single Sonnet 4.5 call on `dedup-1`, `salvage-1`, and `bonds-pressure-1`. It loses on `api-design-1` and `flaky-test-1`.**

Whether that rivals "Opus 4.8 high" or "GPT 5.5 high" depends entirely on how Opus 4.8 and GPT 5.5 actually shape up. If frontier models in 2026-Q3 invest heavily in long-context reasoning, the swarm gap widens on synthesis but narrows on decomposable coordination. **Bet:** Cloudflare-hosted PD swarms become a Pareto-distinct product — *not the strongest model, but the strongest model for coordination-decomposable work at this price point*.

---

## 13. New Surfaces Required

Concrete list of additions, each marked `NEW:` and justified.

| Surface | Module path | Justification |
|---|---|---|
| `NEW: scripts/sandbox/orchestrator.ts` | top-level script | The generational scheduler. Spawns agents, runs trials, scores, selects, repeats. No existing PD module orchestrates evolutionary runs — `fleet-engine.ts` runs a single fleet, not a population. |
| `NEW: lib/trial-rubric.ts` | factory `createTrialRubric(db)` | Deterministic per-trial scoring. Distinct from `coordination-judge.ts` which is LLM-based ambiguity arbitration. |
| `NEW: lib/skill-attention.ts` | factory `createSkillAttention(db)` | Line-level skill-usage tracking. Extends but doesn't replace `usage-telemetry.ts`. |
| `NEW: lib/tool-proposals.ts` | factory `createToolProposals(db)` | Vote-adopted mid-run tool/skill additions. Consumes `messaging` for the vote channel. |
| `NEW: cli/commands/sandbox.ts` | `pd sandbox <run|status|score|gen>` | CLI shim into the orchestrator. |
| `NEW: routes/sandbox.ts` | Fastify plugin | HTTP surface for the dashboard panel. |
| `NEW: docs/research/sandbox-runs/` | directory | Per-run durable ledger. |
| Add column `skill_line_range_json` to `usage_events` | schema migration | Schema alter — see `MEMORY.md` "Use direct psql ... actually run the SQL" — but PD uses better-sqlite3 with idempotent `CREATE TABLE IF NOT EXISTS`. Just add to `lib/db.ts:CORE_SCHEMA_SQL`. |

Estimated implementation cost (eyeballed, not estimated to ship):
- Orchestrator + rubric: 1–2 days of focused work
- Skill attention + telemetry hooks: 1 day
- Tool proposals + vote: 0.5 day
- CLI + routes: 0.5 day
- Dashboard panel: 0.5 day

So ~4–5 days to get to gen-0 running. Add a week for evolutionary stability. Total project: **2 calendar weeks of focused work** before the first publishable result.

---

## 14. Open Decisions for the Operator

These block kickoff. Asking for explicit answers, not vague gestures:

### Q1. Budget commitment

The headline number is $400 for a full M=20 run with Policy A (all-Sonnet). Are you committing $400 to **one** run, or budgeting for the **first 2–3 runs** (so $1200–$1500) since the first run usually surfaces eval-harness bugs that wasted half the spend? My strong recommendation is the latter.

### Q2. Run scheduling — manual vs. fleet daemon

Do you want this orchestrator to run as a *one-shot* (`pd sandbox run <config.yml>`, manual kickoff) or as a *fleet agent* (auto-run nightly when budget refresh)? Manual is dramatically simpler for v0. Fleet is the right long-term answer but introduces daemon-state interactions with the live PD daemon you're using for everyday work.

### Q3. Where do "winning" prompts live in the production roster?

When gen-20 converges with (say) a much better `coxswain` persona, do you (a) replace the canonical `lib/actor-roster.ts` mission string, (b) keep them parallel as `coxswain-evo-v1`, `coxswain-evo-v2`, ..., (c) make them user-selectable via `pd begin --persona <id>`? My instinct is (b) initially, (c) once stable, never (a) without a human review.

---

## 15. Sanity Bound — what would make me kill this

Before recommending kickoff I'd want to know what would make me pull the plug. Three explicit failure modes:

1. **Gen-3 still showing gen-0 personas dominant.** That means evolution isn't doing anything — the selection signal is too weak. Fix the eval, not the mechanism.
2. **Saboteur red-team wins every trial.** Means coordination is too brittle; the main population needs simpler problems first. Drop to 3 trials, build up.
3. **Surviving skills are all the same skill.** Diversity collapse before generation-detection caught it. Tune diversity threshold tighter (0.20 not 0.15), restart.

If any of those hit and three intervention attempts don't fix it — stop, harvest what we learned, write it up, move on. The mark of a real research project is honest stopping.

---

## Appendix A. References (real PD files cited)

- `lib/actor-roster.ts:77` — `ACTOR_ROSTER` 10-persona list (basis for §3.1)
- `lib/spawner.ts:84` — `SpawnSpec` interface (basis for §1.2 process model + §4 backend selection)
- `lib/bonds.ts:87` — `BondState` type and conservation invariant (basis for §6.4)
- `lib/usage-telemetry.ts:17` — `UsageTelemetryRecordInput` schema (basis for §7)
- `lib/attention.ts:101` — `createAttention` factory (basis for the per-agent attention-fetch pattern)
- `lib/fleet-engine.ts:264-281` — `BUILTIN_MODEL_TIERS` model ladder (basis for §4 and §12)
- `lib/episodic-memory.ts:146` — `createEpisodicMemory` (basis for cross-generation memory)
- `lib/coordination-judge.ts:1-30` — boundary between deterministic audit and LLM tiebreaker (basis for §9.3 not using LLM judging for headline pass/fail)
- `lib/coordination-pipeline-audit.ts` — the deterministic-bias rule the judge respects
- `docs/adr/0030-talent-phonebook-coordination-router.md` — the `whois` router (basis for §10.2's "successful-clause-bank" approach)
- `docs/adr/0041-durable-commitments-and-obligation-monitoring.md` — durable commitment ledger pattern
- `~/.claude/CLAUDE.md` "NO KEYWORD-BASED NLP" — basis for §7.4's mechanism choice
- `MEMORY.md` "Resurrection is weak" — honesty discipline applied to `salvage-1` trial design

---

## Appendix B. Recommended starting config (operator copy-paste)

```yaml
# ~/.port-daddy/sandbox/config-v0.yml  [NEW location]
run_id: evo-v0-2026-06
population:
  size: 8
  selection: tournament-3
  carry_forward: 0.30        # top 30% promoted directly
  mutation_rate: 0.15
generations:
  max: 20
  stop_on_stagnation: true
  hv_improvement_threshold: 0.02
trials:
  families: [dedup-1, merge-queue-1, salvage-1, flaky-test-1, api-design-1, free-rider-1, bonds-pressure-1]
  instances_per_family: 3
  repeats_per_instance: 3
  wall_cap_minutes: 30
models:
  policy: A          # all-sonnet baseline
  bodies: claude-sonnet-4-5-20250929
  coordinators: claude-sonnet-4-5-20250929
  synthesizers: claude-sonnet-4-5-20250929
scarcity:
  skill_slots: 5
  mcp_slots: 6
  bond_per_agent_usd: 0.20
  token_cap_per_agent: 50000
budget:
  hard_cap_usd: 400
  soft_warning_usd: 300
  kill_at_usd: 380
adversarial:
  enabled: true
  red_team_size: 4
  injection_rate: 0.4          # 40% of trials carry a saboteur
red_team_trial_families: [free-rider-1, dedup-1, bonds-pressure-1]
telemetry:
  skill_attention: enabled
  per_line_granularity: enabled
output:
  transcripts_dir: ~/coding/tmp/sandbox/{run_id}/transcripts
  generation_dir: docs/research/sandbox-runs/{run_id}
```

This is the file to feed `pd sandbox run` once `cli/commands/sandbox.ts` exists.

---

*End of design. Ready for operator review.*
