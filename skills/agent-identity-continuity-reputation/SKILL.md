---
name: agent-identity-continuity-reputation
description: >
  Design durable agent identity and reputation systems for multi-agent / coding-agent
  fleets. Use when building or reviewing: agent memory/checkpoint that survives a
  process death, "persons not spawns" (role + continuity), registered outcome ledgers,
  Elo/Bradley-Terry/TrueSkill reputation for backends or agents, learned-outcome
  (bandit) routing, and agentic LLM-as-judge reviews. Covers the chain
  memory+checkpoint -> continuity -> durable person -> registered outcomes ->
  reputation -> a tradeable/hireable asset, and the failure modes that make each
  link theater (Sybil-reset, whitewashing, Goodhart, judge bias, cold start).
  Triggers: "agent reputation", "Elo for backends/agents", "agent identity that
  survives respawn", "outcome ledger", "learned routing", "resurrection with teeth",
  "episodic memory for agents", "credit assignment for agents".
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Agent & Orchestration
  tags:
    - agent-identity
    - reputation-systems
    - continuity
    - outcome-ledger
    - elo-trueskill
    - agent-coordination
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: episodic-memory-algorithms
      reason: Supplies the memory/checkpoint mechanics continuity is graded on; this skill decides what continuity must persist, that skill designs how.
    - skill: mechanism-design-for-agent-labor
      reason: A labor market needs a trust signal to price; this skill defines the identity/reputation chain that feeds it, and where that chain silently breaks.
    - skill: agent-labor-pricing-function
      reason: Pricing a hireable agent depends on a reputation input; this skill is the soundness check on that input before it is trusted by a pricing function.
    - skill: multi-agent-coordination
      reason: Coordination protocols assume they are talking to the same durable party across restarts; this skill is the identity/continuity layer that assumption relies on.
  io-contract:
    kind: deliverable
    consumes:
      - kind: agent-identity-reputation-requirement
        format: markdown
      - kind: identity-reputation-design-plan
        format: json
    produces:
      - kind: identity-continuity-reputation-design
        format: markdown
      - kind: reputation-soundness-audit
        format: json
---

# Agent Identity, Continuity & Reputation

A reputation system is only as real as the identity it keys on, and an identity is
only durable if it carries continuity. This skill is the design discipline for the
whole chain — and, crucially, for spotting where each link silently breaks.

## The thesis (the through-line)

```
memory + checkpoint  →  continuity  →  a PERSON (not a spawn)  →  registered
outcomes  →  reputation (Elo/credit)  →  a hireable / sellable asset  →  a market
```

- A **role** is `{obligation, capability, authority}` — org-chart, not biography.
  "Cartographer" is a role; any spawn can fill it.
- A **person** is a role instance **+ continuity**: memory, checkpoint, and an
  outcome history that survives the death of any one process/context window.
- **No reputation without continuity** (you cannot grade an identity that resets).
  **No market without reputation** (you cannot price what you cannot trust).

This mirrors the philosophical **psychological-continuity** criterion of personal
identity (Locke 1689; Parfit, *Reasons and Persons*, 1984): a person at t2 is the
same as at t1 iff there is an overlapping chain of memory/intention connections —
*continuity*, which is transitive, not raw *connectedness*, which is not. An agent
that keeps a memory stream but loses its outcome ledger is connected, not continuous.

## Decision points (work them in order — earlier links gate later ones)

1. **Is the identity non-forgeable?** If an agent can pick its own id, every
   downstream reputation is "climbing an imaginary staircase." STOP and fix
   identity first. Mint an opaque id from the trusted substrate (daemon/server),
   bind it to a credential the agent cannot cheaply re-pick (signing key /
   body-lease). Self-asserted strings become *display aliases only*.

2. **Does continuity actually persist the load-bearing state?** Distinguish three
   things people conflate: (a) **memory** (episodic record of what happened),
   (b) **checkpoint** (restorable execution/belief state), (c) **outcome ledger**
   (append-only, externally-witnessed record of what was *delivered*). Reputation
   keys on (c). If your "resurrection" only passes a text note to a successor, you
   have weak continuity — say so; do not sell it as checkpointing.

3. **Are outcomes registered against an oracle?** An **outcome** must close against
   ground truth the agent cannot author: a merged SHA, a passing test id, a
   released claim, a satisfied monitor. Free-text "Result: done" is not an outcome.
   Add a **sampled adversarial auditor** that re-opens a random + risk-weighted
   fraction of cleared outcomes and re-runs the validation — the only defense
   against hollow-but-technically-met compliance.

4. **What is the reputation estimator, and what does it gate?**
   - Pairwise / tournament signal (agent A's PR beat agent B's on the same task,
     or backend X's diff was preferred to backend Y's) → **Bradley-Terry / Elo**
     for a single latent strength, or **TrueSkill** when you need calibrated
     *uncertainty* (new backend = wide variance, shrinks with games) and team/
     multi-party games.
   - Scalar outcome signal (pass/fail, cost, latency) per (context, backend) →
     **contextual bandit** for learned-outcome routing, conditioned on a
     cost/quality preference vector.
   - **Expose the scalar score as telemetry; gate on concrete predicates** (clean
     exits ≥ N, no open overdue obligations) until the estimator is trusted. Never
     wire a fresh learned scalar straight to a kill/spend gate.

5. **If a judge is in the loop, is it de-biased?** LLM-as-judge has position,
   verbosity, and self-preference biases (Zheng 2023). Swap order and average;
   never let a backend judge its own family unblinded; prefer pairwise to absolute.

## Failure modes (each one turns a link to theater)

Eight named failure modes, one per link in the chain (identity, continuity,
outcome, reputation ×2, judge, sanction), each with its source citation and
concrete defense: `references/failure-modes-and-defenses.md`. Load it before
auditing an existing design or explaining *why* a Quality Gate below failed.

## Quality gates (a design fails review if any is unmet)

- [ ] The reputation keys on a **non-forgeable** id, not a self-asserted string.
- [ ] Closure binds to an **oracle**; there is a **sampled adversarial auditor**.
- [ ] A **newcomer policy** prices churn without locking out genuine first runs.
- [ ] The estimator's **uncertainty** is represented (or exploration is budgeted),
      so a new backend/agent is neither trusted blindly nor starved.
- [ ] The scalar score is **telemetry**, gates are **predicates**, until trusted.
- [ ] Any judge in the loop is **de-biased** (order-swap / blind / pairwise).
- [ ] The honest-ceiling caveat is stated: this proves *delivery against an oracle
      on a clock the agent didn't set*, **not** that the work was *good*.

## Worked example (Port Daddy, the reference implementation target)

- **Built:** episodic memory (`lib/episodic-memory.ts`), actor-soul/body-lease
  split (ADR-0022), resurrection as heartbeat-staleness salvage
  (`lib/resurrection.ts`), bonds escrow (`lib/bonds.ts`), Arbiter regimentation.
- **Designed, not yet built:** non-forgeable id (ADR-0040), durable commitments +
  obligation monitor (ADR-0041), sanction ladder, accountability ledger.
- **The gap that gates everything:** resurrection today *passes notes*, not state;
  identity is still a self-asserted string. So PD has the *organs of continuity*
  but not yet the *spine of reputation*. The build order is forced: identity (0040)
  → outcome ledger (0041) → reputation estimator → routing → market.
  - *Update (ADR-0118, merged 2026-07-15):* the "passes notes, not state" half of
    this is now stale. PD shipped real cross-harness continuation — a
    schema-validated **handoff capsule** carrying workspace state plus tagged
    decisions/coordination, gated by a fail-closed secret scanner, a
    **native-session-witness** verification step, and a **continuation-runtime**
    lease state machine (`lib/continuation-runtime.ts`, `lib/handoff-capsule.ts`) —
    and can do genuine native session resume for four harness adapters (Claude,
    Codex, Agy, Gemini) when the harness owns the session identifier. This does
    **not** close the *spine of reputation* gap: continuation carries state
    forward, but a schema-validated capsule is neither an outcome ledger nor a
    reputation signal, so the forced build order above still stands. See ADR-0118
    and `lib/continuation-runtime.ts` for the current mechanism.

## Future-work designs (richer, deliberately deferred)

- **Role-scoped vocational memory**: a shared memory pooled across all instances of
  a role (every "cartographer" inherits cartographer lessons) — generative, L3+.
- **Backend-scoped baselines**: a backend's reputation as a prior shared across
  every agent it powers, with per-task deltas.
- **Harbor-scoped team memory**: continuity at the fleet level, not just the agent.
- **Evolutionary breeding**: high-reputation persons seed new ones; reputation
  becomes heritable. Powerful and dangerous (mode collapse, Goodhart at the gene
  level) — gate hard.

## Bundle Files

| File | Load When |
| --- | --- |
| `README.md` | Need a quick-start pointer into the bundle. |
| `references/failure-modes-and-defenses.md` | Need the full failure-mode table with sources and the "so what" behind each row. |
| `templates/output-template.md` | Filling in an identity/continuity/reputation design for a specific fleet. |
| `examples/expected-output.md` | Need the shape of a finished design plus a passing audit run. |
| `schemas/reputation-plan.schema.json` | Validating a design plan's structure programmatically. |
| `scripts/reputation_soundness_audit.mjs` | Deterministically auditing a plan for the chain-breaks in the Failure Modes table above. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated design/audit work. |

## References (verify against primary sources; do not cite from memory)

- Locke, J. (1689). *An Essay Concerning Human Understanding*, Bk II ch. xxvii.
- Parfit, D. (1984). *Reasons and Persons.* Oxford UP.
- Friedman, E. & Resnick, P. (2001). The Social Cost of Cheap Pseudonyms. *J. Econ. & Mgmt. Strategy.*
- Douceur, J. (2002). The Sybil Attack. *IPTPS.*
- Strathern, M. (1997). 'Improving ratings': audit in the British University system. (Goodhart's law.)
- Elo, A. (1978). *The Rating of Chessplayers.* / Bradley & Terry (1952).
- Herbrich, R., Minka, T., Graepel, T. (2007). TrueSkill: A Bayesian Skill Rating System. *NeurIPS.*
- Zheng, L. et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. *NeurIPS D&B.*
- Chiang et al. (2024). Chatbot Arena. *arXiv:2403.04132.*
- Park, J.S. et al. (2023). Generative Agents. *UIST.* (memory stream / reflection / retrieval.)
- Nisan, N. et al. (2007). *Algorithmic Game Theory.* (incentive compatibility.)
- Ostrom, E. (1990). *Governing the Commons.* (graduated sanctions.)
- RouterBench / adaptive LLM routing under budget (arXiv:2508.21141, 2510.07429).

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Agent Identity, Continuity & Reputation — Changelog — - Upgraded to the agentic-family bundle standard: added `license`, `allowed-tools`, and `metadata.{category, tags, provenance, pairs-with, i
- [`README.md`](README.md) — Agent Identity, Continuity & Reputation — Design (or audit) the chain: memory+checkpoint → continuity → a durable person (not a spawn) → registered outcomes → reputation (Elo/TrueSki

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: Reputation Design Plan + Audit — Scenario: a fleet is standing up reputation for its coding-agent backends.
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/failure-modes-and-defenses.md`](references/failure-modes-and-defenses.md) — Failure Modes and Defenses (each one turns a link to theater) — Load this when auditing an existing identity/continuity/reputation design, or when a Quality Gate in `SKILL.md` fails and you need the named

**`schemas/`**
- [`schemas/reputation-plan.schema.json`](schemas/reputation-plan.schema.json) — reputation plan.schema (data/schema)

**`scripts/`**
- [`scripts/reputation_soundness_audit.mjs`](scripts/reputation_soundness_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Agent Identity / Continuity / Reputation Design Template — [One-sentence description of the fleet/system this design covers.] - Minting authority: [daemon / server / other trusted substrate] - Creden

<!-- END BUNDLE INDEX -->
