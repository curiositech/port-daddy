---
name: context-economics-for-agent-swarms
description: >
  Treat tokens as a coding swarm's cost-of-goods-sold AND its legibility engine.
  Covers per-agent context budgeting, compaction strategies (in-context summarization,
  structured note-taking, sub-agent isolation), the shared digest as compaction-for-humans-
  and-agents, the context-degradation cascade (lost-in-the-middle, context rot, recursive-
  summarization collapse), and mechanism design for metering token spend across a fleet.
  Activate on: "token budget", "context budget per agent", "compaction strategy", "digest /
  briefing as compression", "context window degradation / context rot", "summarization
  collapse", "COGS for agents", "metering agent token spend", "pheromone decay as forgetting",
  "/context-economics-for-agent-swarms". NOT for: memory storage architecture (use
  always-on-agent-architecture), single-prompt wording (use prompt-engineer), pure
  mechanism-design proofs (use nisan-et-al-2007-algorithmic-game-theory).
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
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
    owners: [port-daddy]
  pairs-with:
    - skill: always-on-agent-inputs
      reason: Per-tier context budgeting + retrieval strategy this skill prices
    - skill: wang-et-al-2025-tdag
      reason: Context precision vs bloat and the cascading-failure model
    - skill: nisan-et-al-2007-algorithmic-game-theory
      reason: Mechanism design for metering and charging token spend
    - skill: episodic-memory-algorithms
      reason: Promotion of transient turns into durable compressed episodes
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: Context budget allocation, caching, and compaction strategy across a swarm with cost accounting
---

# Context Economics for Agent Swarms

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

## CORE FRAME — three identities of one resource

| Identity | What a token is here | Who pays attention | The optimization target |
|---|---|---|---|
| **COGS** | a metered variable cost charged per task | the operator / the market | minimize $ per landed unit of work |
| **Working memory** | a slot in a finite **attention budget** | the agent mid-task | maximize signal density before degradation |
| **Legibility lens** | a unit of the digest someone else reads | the human + successor agents | maximize recall-of-truth, zoom preserved |

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

Rule of thumb: **budget to the effective context, not the advertised window.** Empirically
the window where models stay within ~85% of short-context accuracy is far smaller than
the marketing number (often single-digit-thousands of tokens), so packing to 200K is
buying degradation, not capability.

### 2. Which compaction strategy when context fills

**Two families of move, both non-destructive when done right.** *Macro-compaction*
operates on message *ranges*: lay a non-destructive **overlay** over a span of cold
history — a pointer overlay when the range is reconstructable, a summary overlay when it
isn't — and never delete the original, so you can always zoom back. When you re-summarize,
pass the *old summary back in view* and update it rather than re-deriving from scratch
(that iterative discipline is what stops recursive-summarization collapse — see FAILURE
MODES). *Micro-compaction* is the cheap read-time pass underneath: truncate individual
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
    │     pulls them back on demand. (PD: `pd note`, episodic memory.)
    └─ Parallel exploration
        → SUB-AGENT ISOLATION: spawn clean-window workers, each returns a
          1–2K digest. Isolation IS compaction — the parent never sees the bloat.
```

> **Boundary rule — never split a pair.** Any move that summarizes or truncates message
> history — macro range overlays and micro tool-output truncation alike — must shift its
> boundaries so a `tool_use` and its matching `tool_result` are never separated. Drop one
> and keep the other and you get a hard 400 that only `/clear` fixes: this is the
> claude-code #14173 / #40305 failure class, and it is exactly why boundary-aware ranges
> exist. Make it a precondition on every compaction step, not a cleanup afterthought.

*Durable-agents cross-reference:* micro/macro compaction, overlays, and boundary-aware
ranges are the *in-session* half of the durable-agent picture. For the full industry
comparison (Cloudflare, Temporal, LangGraph, Letta) and how Port Daddy's primitives map
onto it, see `docs/product-research/durable-agents-landscape-2026-07.md`.

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

---

## FAILURE MODES (the context-degradation cascade)

**Lost-in-the-middle starvation.** *Symptom:* agent retrieves the right document/tool but
reasons as if it didn't; accuracy depends on *where* in the window the fact sat.
*Root cause:* models use the beginning and end of context far better than the middle.
*Detection:* same fact, two positions, two answers. *Fix:* put the critical fact at
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

**Schema/tool bloat.** *Symptom:* agents pick the right tool with wrong params; high cost,
low accuracy. *Root cause:* 50 tools loaded into every window. *Detection:* >30% of context
unused per response. *Fix:* 3–5 always-loaded tools, discover the rest (context precision).

---

## WORKED EXAMPLE — a 6-agent feature swarm

**Task:** ship a feature across 6 parallel agents under one operator, $-capped.

1. **Budget by role.** Orchestrator: 12K (plan + six 1.5K digests). Each worker: 40K clean
   window, ≤4 tools. Reviewer: 8K anchored on the diff.
2. **Compact by reconstructability.** Worker tool output that's in git → evict + pointer.
   Worker reasoning that isn't → structured note (`pd note`) so the successor can re-read it.
3. **Build the shared digest twice, for two readers.** For the operator's Attention Queue:
   "6 agents, 4 landed, 1 blocked on a claim conflict (→PR #123), 1 over budget (→kill?)."
   Every clause deep-links. For an arriving 7th agent: open claims + unfinished obligations
   as pointers, not prose.
4. **Meter.** One token-ledger row per agent-task. Agent 5 blows its cap → loud-fail, surfaced
   in the same digest. No auction (single operator) — just visibility.
5. **Watch the cascade.** Reviewer compacts from the *diff*, never from worker summaries, so a
   worker's hallucinated claim can't propagate into the merge decision.

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
