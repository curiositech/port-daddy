# 0111. The parley protocol — a bounded, typed convening for converging agents (RCP-3)

## Status

Proposed

## Context

The recursive-control-plane research line (`whitepaper/research/program/archive/control-plane/2026-06-15-recursive-control-plane.md`,
promoted into `whitepaper/research/program/archive/north-star/00-THE-LEDGER-open-problems.md` § D as **RCP-3**)
calls for a **parley**: when two agents are doing the *same thing*, or are in
unresolved *disagreement*, the swarm should suspend informal parallel work,
convene a structured round to reallocate or reconcile, then resume. The Ledger
marks RCP-3 "designed, unbuilt." Its message primitives, however, now exist:

- **Typed performatives** on the tube envelope (`lib/tube.ts`, ADR-0047 Phase 0):
  `inform / request / propose / accept / reject / refuse / failure / cancel /
  query / not-understood / escalate / distress`.
- **Argumentative `relationship`** on the same envelope (RCP-3b, `lib/tube.ts`):
  `supports / contradicts / extends / narrows / synthesizes`.
- **The argument graph** (RCP-14, `lib/discourse-lineage.ts`): turns a thread's
  `inReplyTo` edges into a digest that flags **unresolved contradictions**.

What is missing is the *dialogue layer* over these primitives: who may speak,
what each message commits, how a round terminates, and when it escalates to a
human. Designed without that discipline, a "parley" degrades into the classic
multi-agent failure modes (delegation ping-pong, sycophancy collapse, supervisor
bottleneck, blackboard rot). This ADR specifies the protocol; it is the spec the
**parley trigger** (RCP-2a, the entry gate) fires into.

## Decision

Adopt a single parley protocol with **two sub-shapes selected by trigger type**,
a **sovereign convener**, and **hard termination**.

### 1. Classification — the trigger picks the shape

| Trigger | Shape | Why |
|---|---|---|
| **Duplication** — convergence detector finds two agents on the same task-shape, no disagreement | **Contract-Net** (supervisor-worker): cfp → bids → award → commit. No judge. | The problem is allocation, not truth. |
| **Contradiction** — RCP-14 digest reports a non-empty `unresolvedContradictions` | **Debate-with-judge** embedded in the convening | Disagreement improves quality *only* when a resolution surface exists (a `synthesizes` move, or operator HITL). |

A contradiction with **no** resolution surface is `consensus`/voting, not debate —
the protocol must not dress voting up as debate.

### 2. Roles — asymmetric by construction

| Role | Who | Bounded to |
|---|---|---|
| **Convener** | the **daemon** (the sovereign that exists inside one operator's box — the symmetry the kernel relies on) | plan + gather + decide allocation/synthesis. It does **not** relay every message. |
| **Participants** | the converging / contradicting agents | hold **one** position; cite evidence each turn. |
| **Judge** | a neutral agent for resolvable contradictions; the **operator** (via `escalate`/`distress`) otherwise | resolve, or exhaust a **disagreement budget** then escalate. |

### 3. Message intents map onto the shipped enum

`request`/`query` = call-for-proposals · `propose` = bid · `accept`/`reject` =
award (decide) · `inform` + `relationship` = a debate turn · `escalate`/`distress`
= hand to the operator. **One gap:** there is no durable-commitment performative;
`accept` carries the decision but a dedicated `commit`/`finalize` act would make a
parley's output (the reallocation + commitments) unambiguous. Adding it is a small
follow-up to the `Performative` union and is the only protocol-level primitive
this design lacks.

### 4. Turn order and gather rule

`cfp → bids (parallel; gather = all-or-timeout) → award → commit`. The
contradiction sub-round runs with fixed perspectives, ≤ *N* turns per side, and a
judge that may not declare consensus before the disagreement budget is spent.

### 5. Termination — the load-bearing part

A parley with stop conditions of "until done" / "until consensus feels right" is
hope, not a protocol. Every parley carries:

- **Round caps:** ≤ 2 Contract-Net rounds; ≤ 3 debate turns per side.
- **Cost ceiling:** the **RCP-2a** signal-detection gate (`P(fail) × waste > cost`)
  governs *entry*; a second budget governs *staying*. This is the same SDT spine
  as Ledger **RQ-7** (operator-attention) — convene only when the expected cost of
  *not* coordinating beats the coordination overhead.
- **Loop detection:** the envelope's `delegationChain` plus RCP-14's
  *repeated* `unresolvedContradictions` on the same target = "same task-shape
  twice in one branch" → terminate. Upward delegation is blocked by default.
- **Escalation:** judge unresolved or budget exhausted → `escalate`/`distress` to
  the operator (force-zoom / HITL). This is the recursive control plane in action:
  an agent↔agent round that cannot close escalates to the operator→agents tier.

### 6. Failure-mode guards already have a home

| Failure mode (agent-conversation-protocols) | Guard, and where it lives today |
|---|---|
| Delegation ping-pong | `delegationChain` (envelope) + RCP-14 repeated-contradiction termination |
| Sycophancy collapse | fixed perspectives + evidence-per-turn; `relationship` *types* the stance so "agreement" can't masquerade as a turn; judge disagreement budget |
| Supervisor bottleneck | convener decides allocation/synthesis only; participants post directly to the tube channel (blackboard) |
| Blackboard state rot | the tube channel already carries a TTL (`lib/messaging.ts`); the RCP-14 **digest is the relevance filter** — read the digest, zoom only into contradictions |
| Context degradation cascade | RCP-14 is the skill's "summaries are indexes, not replacements" rule made real — the digest indexes, the messages stay on-channel; a parley is one flat round per `conversationId`, not deep re-delegation |

## Consequences

- **Positive.** RCP-3 stops being a slogan: each quality gate from the
  conversation-protocol discipline maps to a primitive that already ships, which
  is strong evidence the design is real and not protocol-vocabulary cosplay. The
  trigger (RCP-2a) gets a defined thing to fire into; the lineage work (RCP-14)
  gets a consumer; the operator gets a single, bounded escalation surface.
- **Cost / risk.** A convening agent is new machinery the daemon must own
  (convene, gather, award, time out). The largest correctness risk is the
  termination logic — an unbounded or loop-prone parley is worse than none — so it
  is specified first and must be the most-tested part. The missing `commit`
  performative should land before the protocol is built.
- **Reversible.** Until the convener is built, nothing changes; agents keep doing
  informal parallel work. The trigger can ship and *recommend* a parley (surface
  it in `pd tube --lineage`) before any automated convening exists.

## Related

- `whitepaper/research/program/archive/north-star/00-THE-LEDGER-open-problems.md` § D — RCP-2 (trigger),
  RCP-3 (this protocol), RCP-3b (performatives), RCP-14 (lineage), RQ-7 (the SDT spine).
- `lib/tube.ts` — the typed performative + `relationship` envelope the protocol speaks.
- `lib/discourse-lineage.ts` — the argument graph + `unresolvedContradictions` the trigger reads.
- ADR-0047 — the conversation-protocol envelope (Phase 0 performatives) this builds on.
- ADR-0039 — operator→agent suggestibility; the parley is its agent↔agent analog.
- `~/.claude/skills/agent-conversation-protocols` — the design discipline applied here.
