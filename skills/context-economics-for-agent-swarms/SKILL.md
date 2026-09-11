---
name: context-economics-for-agent-swarms
description: >
  Treat tokens as a coding swarm's cost-of-goods-sold and legibility engine while
  accounting for finite subscription allowance when per-call price is unknown.
  Covers provider windows, remaining-usage evidence, burn forecasts, preemptive
  checkpoint/model switching, per-agent budgets, compaction, shared digests,
  context degradation, and spend metering. Activate on: "token budget", "context
  budget", "compaction strategy", "briefing as compression", "context rot",
  "summarization collapse", "COGS for agents", "subscription usage remaining",
  "five-hour or weekly limit", "burn forecast", "model switch before limit", or
  "/context-economics-for-agent-swarms". NOT for: memory architecture (use
  always-on-agent-architecture), single-prompt wording (use prompt-engineer),
  mechanism-design proofs (use nisan-et-al-2007-algorithmic-game-theory), physical
  containment (use sandboxed-adversarial-test-harness), or production rebodiment
  and fencing (use agent-resurrection-and-body-continuity).
license: Apache-2.0
allowed-tools: Read,Write,Edit,Grep,Glob,Bash(node:*)
metadata:
  category: AI & Agents
  tags:
    - context-economics
    - token-budget
    - compaction
    - legibility
    - digest
    - agent-swarms
    - cogs
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: always-on-agent-inputs
      reason: Per-tier context budgeting + retrieval strategy this skill prices
    - skill: wang-et-al-2025-tdag
      reason: Context precision vs bloat and the cascading-failure model
    - skill: nisan-et-al-2007-algorithmic-game-theory
      reason: Mechanism design for metering and charging token spend
    - skill: episodic-memory-algorithms
      reason: Promotion of transient turns into durable compressed episodes
    - skill: agent-resurrection-and-body-continuity
      reason: Consumes capacity evidence when a living worker may need a new body.
    - skill: sandboxed-adversarial-test-harness
      reason: Falsifies forecasts and reservations in an inert laboratory.
  io-contract:
    kind: deliverable
    produces:
      - kind: capacity-evidence
        format: json
        description: Native-window observations, shared-bucket reservations, holds, eligibility, and forecast uncertainty without launch authority
      - kind: design-doc
        description: Context budget allocation, caching, and compaction strategy across a swarm with cost accounting
---

# Context Economics for Agent Swarms

## Halt and authority gate

This skill observes, forecasts, and returns capacity evidence. It does not admit
a body, authorize a provider call, transfer identity, clear an operator/runtime
halt, or issue a rebodiment verdict. During a halt, work only from inert files,
schemas, fixtures, PR evidence, and fake observations. Any live observation or
durable note must use an independently authorized interface outside this skill.

**The two-sentence thesis.** In a fleet of coding agents, *tokens are simultaneously
the bill and the map.* They are the **cost-of-goods-sold (COGS)** — the metered,
per-task variable cost any economy must account for — and they are the **legibility
mechanism**: the only way a human (or another agent) ever sees what a swarm did is a
*compaction* of its raw trajectory. The digest IS compaction. So the same engineering
choice — what to keep, what to drop — is at once a cost-control decision and a
truth-telling decision. Optimize one without the other and you ship a fleet that is
either bankrupt or illegible.

This skill is for deciding **how many tokens each agent gets, how that context is
compacted as it fills, how the swarm's shared digest is produced, and how to detect
the failure cascade when compaction lies.**

---

## CORE FRAME — four economic views that must not collapse

| Identity | What a token is here | Who pays attention | The optimization target |
|---|---|---|---|
| **COGS** | a metered variable cost charged per task | the operator / the market | minimize $ per landed unit of work |
| **Working memory** | a slot in a finite **attention budget** | the agent mid-task | maximize signal density before degradation |
| **Legibility lens** | a unit of the digest someone else reads | the human + successor agents | maximize recall-of-truth, zoom preserved |
| **Scarce allowance** | a provider-native subscription window consumed without a stable per-call price | the operator + capacity broker | preserve useful headroom and reset-aware optionality |

> **Legibility-with-zoom (the cardinal rule).** Every digest is a *lens onto the real
> artifact, never a replacement for it.* Over-flattening — a summary you cannot zoom
> back from to the source — is the failure mode, not the goal. (This is Scott's warning
> about high-modernist over-legibility crushing local knowledge, applied to compaction.)

---

## DECISION POINTS

### 1. Per-agent context budget allocation

```
What is this agent's role on the task?
├─ Orchestrator / planner
│   └─ SMALL working budget, LARGE digest-read budget.
│      It should hold the plan + sub-agent summaries, NOT raw tool output.
│      Budget: ~system 4K + plan 4K + N×(1–2K sub-agent digests).
├─ Deep worker (edits files, runs tools)
│   └─ LARGE working budget, but CLEAN window (sub-agent isolation).
│      Give it ≤3–5 always-loaded tools; discover the rest. Return a
│      1–2K distilled summary upward, NOT its transcript.
└─ Reviewer / auditor
    └─ MEDIUM budget anchored on the DIFF + the obligation, not history.
       Re-derive from artifacts (git, claims) over scrollback.
```

Rule of thumb: **budget to measured effective context, not the advertised
window.** Context degradation depends on model, task, tool traffic, and evidence
placement; no universal accuracy percentage or token threshold is asserted
here. Establish a versioned benchmark for the exact route and task class before
using a threshold for automation.

### 2. Which compaction strategy when context fills

**Two families of move, both non-destructive when done right.** *Macro-compaction*
operates on message *ranges*: lay a non-destructive **overlay** over a span of cold
history — a pointer overlay when the range is reconstructable, a summary overlay when it
isn't — and never delete the original, so you can always zoom back. When you
re-summarize, regenerate factual claims from immutable artifacts. The previous
summary may remain in view only as untrusted comparison input for omission and
drift detection; it is never the factual source. *Micro-compaction* is the cheap read-time pass underneath: truncate individual
aged tool outputs (keep the last ~4 intact, replace oversized rows with previews)
continuously, long before you reach for a macro pass.

```
Is the dropped content reconstructable from a durable artifact (git, DB, files)?
├─ YES → prefer EVICTION + POINTER — macro-compaction as a POINTER OVERLAY. Keep a
│         path/ID/summary in place of the raw bytes; the original stays reachable,
│         zoom-back intact. (Cheapest, lossless-by-reference. PD's claims/notes/tuples
│         are pointers.)
└─ NO  → must SUMMARIZE. Choose:
    ├─ Single long thread nearing the limit
    │   → IN-CONTEXT COMPACTION — macro-compaction as a SUMMARY OVERLAY: summarize
    │     history *ranges*, reinitiate the window with the summary + recent artifact refs.
    │     Keep the old summary in view and originals underneath; never delete outright.
    │     Maximize RECALL first, then trim for precision.
    ├─ Long task with milestones
    │   → STRUCTURED NOTE-TAKING: agent writes durable notes OUTSIDE the window,
    │     pulls them back on demand through an authorized durable artifact or note interface.
    └─ Parallel exploration
        → SUB-AGENT ISOLATION: spawn clean-window workers, each returns a
          1–2K digest. Isolation IS compaction — the parent never sees the bloat.
```

> **Boundary rule — never split a pair.** Any move that summarizes or truncates message
> history — macro range overlays and micro tool-output truncation alike — must shift its
> boundaries so a `tool_use` and its matching `tool_result` are never separated. Drop one
> and keep the other can make a provider reject the reconstructed history. This
> has been observed in specific harness versions, but is not asserted as a
> universal status code or recovery command. Make pair integrity a precondition
> on every compaction step and keep a versioned reproduction fixture.

*Durable-agents cross-reference:* micro/macro compaction, overlays, and boundary-aware
ranges are the *in-session* half of the durable-agent picture. For the full industry
comparison (Cloudflare, Temporal, LangGraph, Letta) and how Port Daddy's primitives map
onto it, see `docs/research/durable-agents-landscape-2026-07.md`.

### 3. Shared digest (the swarm's compaction) — granularity

```
Who reads this digest, and can they zoom?
├─ The human operator (Attention Queue)
│   → headline + counts + the ONE thing needing a decision. Must deep-link to
│     the PR/diff/note. If it can't zoom, it's over-flattened — reject.
├─ An arriving / successor agent (briefing, resurrection handoff)
│   → "what happened before you got here": open claims, recent notes, unfinished
│     obligations. Bias toward POINTERS over prose (cheaper, re-fetchable, honest).
└─ The market / billing layer (L3)
    → not prose at all: a metered ledger of tokens-per-task keyed to outcomes.
```

### 4. Metering / charging token spend across a fleet (mechanism design)

```
Are agents under one operator (cooperative) or across operators (strategic)?
├─ Cooperative (single-player wedge)
│   → ACCOUNT, don't auction. Per-agent/per-task token ledger, budget caps,
│     loud-fail when an agent blows its cap. No incentive problem — just visibility.
└─ Strategic (multi-operator market)
    → token spend is real COGS that must be priced. Charge the externality
      (an agent that floods shared context degrades everyone). Beware sybil:
      cheap identities let a fleet split work to dodge caps — tie spend to a
      costly, persistent identity (see reputation/continuity).
```

### 5. Subscription capacity when per-call cost is unknowable

A prepaid subscription is not `FREE`. Keep two ledgers:

- **financial:** recurring commitment, API/prepaid dollars, product credits,
  reservations, charges, and refunds;
- **capacity:** provider-native percentage/request/token windows, reset times,
  context, concurrency, and observation quality.

Do not invent a cross-provider exchange rate or “tasks remaining.” Condition a
burn distribution on provider, model, effort, task class, context, tool pack, and
execution mode. Return `eligible` only when fresh allocatable native capacity—
after operator reserve, outstanding reservations, unresolved-attempt holds,
drift margin, and checkpoint tail—covers forecast p95 burn. A separate lifecycle
authority decides admission. Tighten capabilities and checkpoint before the hard
wall; hibernate with no process when no route fits. `null`, stale, unsupported,
or contradictory observations mean `UNKNOWN`, not unlimited use.

Port Daddy coordination commands such as `pd` are outside this skill and remain
subject to the active operator/runtime policy. Never invoke them merely to fill
or persist a capacity report, especially while a halt is active.

Read `references/subscription-capacity-ledger.md` before designing an allowance
observer, backend ranking, model switch, or subscription-backed fleet budget.
Emit `capacity-evidence` that validates against
`schemas/capacity-evidence.schema.json`, then run
`scripts/validate-capacity-evidence.mjs` for native-unit arithmetic, alias
conservation, freshness, reservation coverage, and execution-class separation.
`fake-or-replay` evidence can fit only a simulation; `real-provider` evidence
that supports automatic use must come from a documented structured provider or
first-party client source. The evidence says whether a route fits; it never
grants admission or launch authority.

---

## FAILURE MODES (the context-degradation cascade)

**Lost-in-the-middle starvation.** *Symptom:* agent retrieves the right document/tool but
reasons as if it didn't; accuracy depends on *where* in the window the fact sat.
*Root cause:* models use the beginning and end of context far better than the middle.
*Detection:* same fact, two positions, two answers. *Fix:* put the foundational fact at
an edge; shorten the window; don't bury the obligation in scrollback.

**Context rot.** *Symptom:* quality silently decays as the session grows even though nothing
was dropped. *Root cause:* every token spends the finite attention budget; transformer
attention is n² and stretches thin. *Detection:* accuracy vs. token-count curve bends down
well before the advertised limit. *Fix:* compact earlier and more aggressively; budget to
effective context.

**Recursive-summarization collapse.** *Symptom:* after several compaction rounds the agent
confidently asserts things that never happened. *Root cause:* each summary injects a little
LLM noise; recursion compounds it into cascading hallucination. *Detection:* claims in the
digest with no backing artifact; drift from the source on re-read. *Fix:* compact from the
*artifacts* (git, notes, DB) on each round, not from the previous summary; keep zoom-back
links so every claim is auditable.

**Over-flattening (the Scott failure).** *Symptom:* the digest reads clean and green, but the
operator can't act because the real situation isn't reachable. *Root cause:* summary became a
replacement, not a lens. *Detection:* a digest line with no deep-link to its artifact. *Fix:*
every digest item must zoom; ban terminal summaries that can't be drilled into.

**Compaction-as-cost-blindness.** *Symptom:* fleet bill balloons; nobody can say which agent
or task spent it. *Root cause:* tokens never metered per task. *Detection:* no token ledger
keyed to outcomes. *Fix:* account first (a per-task token row), price later (only in the
multi-operator market).

**Subscription-as-free fiction.** *Symptom:* the scheduler exhausts the operator's
included Codex or Claude allowance while the ledger reports `$0`. *Root cause:*
incremental cash was confused with economic scarcity and authentication mode was
not witnessed. *Detection:* subscription route has no native-window observation,
reset horizon, reserve, or before/after delta. *Fix:* preserve provider units,
show observation quality, reserve p95 burden, and block autonomous launch when
remaining capacity is unknown.

**Schema/tool bloat.** *Symptom:* agents pick the right tool with wrong params; high cost,
low accuracy. *Root cause:* 50 tools loaded into every window. *Detection:* >30% of context
unused per response. *Fix:* 3–5 always-loaded tools, discover the rest (context precision).

---

## WORKED EXAMPLE — a 6-agent feature swarm

**Task:** ship a feature across 6 parallel agents under one operator, cash- and
subscription-capacity-capped.

1. **Budget by role.** Orchestrator: 12K (plan + six 1.5K digests). Each worker: 40K clean
   window, ≤4 tools. Reviewer: 8K anchored on the diff.
2. **Compact by reconstructability.** Worker tool output that's in git → evict + pointer.
   Worker reasoning that isn't → an authorized structured artifact or note so the successor can re-read it.
3. **Build the shared digest twice, for two readers.** For the operator's Attention Queue:
   "6 agents, 4 landed, 1 blocked on a claim conflict (→PR #123), 1 over budget (→kill?)."
   Every clause deep-links. For an arriving 7th agent: open claims + unfinished obligations
   as pointers, not prose.
4. **Meter.** One token-ledger row per agent-task. Agent 5 blows its cap → loud-fail, surfaced
   in the same digest. No auction (single operator) — just visibility.
5. **Watch the cascade.** Reviewer compacts from the *diff*, never from worker summaries, so a
   worker's hallucinated claim can't propagate into the merge decision.
6. **Preserve allowance.** The five-hour window enters `TIGHTENING`; the scheduler
   launches no seventh worker, checkpoints the two longest episodes, and waits
   rather than calling the subscription route free.

**Novice vs expert:** novice gives all 6 agents 200K windows and one flat end-of-run summary
(bankrupt + illegible + hallucinated). Expert budgets to effective context, isolates workers,
compacts from artifacts, and ships a zoomable digest plus a per-task bill.

---

## QUALITY GATES

- [ ] Each agent has an explicit per-tier token budget sized to *effective* context, not the advertised window.
- [ ] Every compaction step has a chosen strategy (evict+pointer / in-context summary / structured note / sub-agent isolation) with a stated reason.
- [ ] Recursive summaries compact from durable artifacts, not from the previous summary.
- [ ] Every digest item deep-links to its source artifact (zoom-back enforced; no terminal summaries).
- [ ] The digest is produced per-reader (operator vs successor agent vs billing), not one-size-fits-all.
- [ ] Token spend is metered per agent-task in a ledger keyed to outcomes; cap breaches loud-fail.
- [ ] Cash, product credits, and subscription windows remain distinct native-unit ledgers.
- [ ] Every subscription route records authentication mode, observation quality, remaining/reset evidence, reserve, and forecast error.
- [ ] Missing capacity is `UNKNOWN`; no scheduler infers unlimited, empty, or zero-cost capacity.
- [ ] p95 action burn plus checkpoint tail fits allocatable capacity after reserve, outstanding reservations, unresolved-attempt holds, and drift margin.
- [ ] Pricing/auctions appear ONLY in the multi-operator case; the single-operator case accounts, it does not charge.
- [ ] Tool exposure ≤3–5 always-loaded; the rest discovered (context precision).
- [ ] A position/length sanity check exists (critical facts at edges; accuracy-vs-length curve known).

## NOT-FOR BOUNDARIES

- **Memory storage architecture** (vector stores, tiers, persistence) → `always-on-agent-architecture`.
- **What to capture as input / retrieval weighting** → `always-on-agent-inputs`.
- **Single-prompt wording** → `prompt-engineer`.
- **Formal mechanism-design proofs (VCG, PoA bounds)** → `nisan-et-al-2007-algorithmic-game-theory`.
- **Dynamic task decomposition / replanning** → `wang-et-al-2025-tdag`.

## KEY SOURCES

- Anthropic, *Effective Context Engineering for AI Agents* (2025) — compaction, structured note-taking, attention budget, context rot, sub-agent isolation.
- Liu et al., *Lost in the Middle* (TACL 2024 / arXiv:2307.03172) — positional degradation.
- Acon (arXiv:2510.00615), Parallel Context Compaction (arXiv:2605.23296), Slipstream (arXiv:2605.08580) — compaction validation + collapse.
- Nisan, Roughgarden, Tardos, Vazirani, *Algorithmic Game Theory* (2007) — metering, externalities, sybil.
- Scott, *Seeing Like a State* (1998); Hobbes, *Leviathan* (1651) — legibility-with-zoom, the consented authority.
- `references/subscription-capacity-ledger.md` — official provider observation
  surfaces, native-unit schema, evidence quality, and fail-cheap preemption.

## Bundle Index

- `references/subscription-capacity-ledger.md` — subscription-capacity truth and
  preemption rules.
- `schemas/capacity-evidence.schema.json` — versioned native-unit evidence and
  reservation contract; load whenever capacity may gate a body or model call.
- `scripts/validate-capacity-evidence.mjs` — deterministic arithmetic, freshness,
  alias, and reservation verifier.
- `examples/capacity-evidence.ready.json` — admissible fake-observer fixture.
- `examples/capacity-evidence.unknown.json` — supported fail-closed unknown
  fixture.
- `agents/openai.yaml` — optional specialist descriptor with explicit
  non-authority and no-live-observation boundaries.
- `tests/activation.md` — positive and negative routing cases.
- `CHANGELOG.md` — evolution of the skill contract.
