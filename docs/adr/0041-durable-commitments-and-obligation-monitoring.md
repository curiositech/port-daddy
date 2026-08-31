# 0041. Durable Commitments and Obligation Monitoring

## Status

Proposed

## Context

We want an agent to *own* a standing job — keep tests green, keep the roadmap free of
contradictions, keep docs in sync — rather than do it once and forget. Today that
"responsibility" lives in a prompt and dies with the context window. The research in
`whitepaper/research/program/archive/accountability/agent-accountability-proposal.md` traces the fix to the classical agent
canon and lands on one structural distinction (the only mechanism of 29 to survive
adversarial review unhardened):

> You **cannot regiment an obligation** — only enforce it. **Regimentation** (Jones &
> Sergot 1993, on **deontic logic** in computer systems — *making a forbidden state
> physically unreachable*) is what the **Arbiter** (`lib/arbiter.ts` — *a runtime monitor
> that records and sometimes blocks forbidden coordination states such as double-claimed
> ports*) does for *prohibitions*. But responsibility is an **obligation** ("must close out
> what you claimed"), which is intrinsically violable and can only be caught by a monitor +
> sanction.

Port Daddy already has the prohibition half (Arbiter) and a liveness watchdog —
**resurrection** (`lib/resurrection.ts` — *a heartbeat-staleness detector that flags dead
agents for salvage*). What it lacks is the **obligation** half: nothing holds an agent to a
promise that comes due *later*. ADR-0033 itself names this gap ("claims have no TTL today…
a follow-up ADR can add a stale claim sweeper") and never closed it.

## Decision

Add a durable **commitment** object and its monitor — the obligation dual of resurrection.
Resurrection asks *"is the agent alive?"*; this asks *"did the agent keep its word?"*.

### The commitment object — `lib/commitments.ts`

A durable SQLite row (idempotent `CREATE TABLE IF NOT EXISTS`, the module-factory pattern),
bound 1:1 to a non-forgeable `actor_id` (ADR-0040):

```
commitments(
  id, owner_actor_id, object_text,
  success_check, impossible_check, motivation_check,   -- the three drop conditions
  due_at,                                               -- DAEMON-derived, not agent-set
  commitment_strategy,                                  -- single-minded | open-minded
  state,                                                -- open | done | abandoned | superseded
  closed_by_oracle_ref,                                 -- FK to a real claim/SHA/test id
  created_at
)
```

This encodes **commitment as a persistent goal** (Cohen & Levesque 1990, *Intention Is
Choice with Commitment* — *a goal dropped only when achieved, believed impossible, or
unmotivated*). The three `*_check` columns are the executable drop conditions; firing any
one transitions the row and writes an immutable note recording *which* condition fired.

Critical design rules drawn directly from the five laws:

- **Auto-enrolled (Law: no escape).** Acquiring a **claim** (`docs/adr/0038-claim-tree.md` —
  *an advisory announcement that an agent intends to touch a file/region*) **creates** the
  commitment row. "Make no promise" is therefore impossible — you cannot claim without owing.
- **`due_at` is daemon-derived (Law 1).** The agent picks the *work*; the **daemon** derives
  the *deadline* from a policy/SLA keyed on commitment type and claimed scope. The agent
  never authors the number that grades it. This is the property that makes resurrection
  Goodhart-resistant, preserved here.
- **Closure binds to an oracle (Law 2).** `state='done'` is reachable only with a
  `closed_by_oracle_ref` — a released claim, a merged commit SHA, a passing test id, or a
  satisfied Arbiter sub-check. An **oracle** here is *a trusted source of ground truth the
  agent cannot author*. Free-text "Result: …" notes do **not** close a commitment.

Verb: `pd commit "<object>" --success <cmd> --impossible <cmd>` and `pd obligations`.

### The obligation monitor — `lib/obligation-monitor.ts`

A periodic daemon sweep, the structural mirror of `resurrection.check`, over commitments
rather than heartbeats. On each tick (and on relevant events) it evaluates open commitments
whose `due_at` has passed with content unmet, emits `OBLIGATION_OVERDUE` on the activity
stream, applies a grace window, then escalates. Per **runtime verification** (Leucker &
Schallhart 2009 — *compiling a property into an online monitor over an event stream*), this
turns "tests stay green" into a continuously-checked property.

Hardening that is non-negotiable (from the adversarial review):

- **Monotonic clock (Law 1).** Use `CLOCK_MONOTONIC` (*a clock that never runs backward and
  ignores wall-clock adjustment*) plus resurrection's existing sleep-detection, or laptop
  sleep makes every commitment instantly overdue — a false-positive storm that trains the
  operator to ignore the alarm.
- **Fail closed (Law 4).** `OBLIGATION_OVERDUE` must be a *pure runtime rule* like
  HEARTBEAT_FRESHNESS, never an Arbiter rule that requires the Rust enforcer FFI — otherwise
  it silently degrades to a stub on any install missing the prebuilt lib, reports healthy,
  and enforces nothing.
- **Sampled adversarial auditor (Law 2).** A random + risk-weighted fraction of *cleared*
  commitments are re-opened by an independent reviewer that re-runs the claimed validation
  and judges the closing note against the diff. This is the only defense against
  hollow-but-technically-met compliance; more presence-checks do not help.
- **Reconcile with resurrection.** A dead agent's open commitments are voided or reassigned,
  not fired against forever.

### Sanction and ledger (follow-ons, separate ADRs)

The monitor's escalation feeds a **graduated sanction ladder** (Ostrom 1990, *Governing the
Commons* — *escalating penalties, warning first, exile last*) keyed on the ADR-0040
principal, and an append-only **accountability ledger** (daemon-witnessed only). Both depend
on ADR-0040 and are deliberately scoped out of this ADR; they are roadmap items
`graduated-sanction-ladder` and `accountability-ledger`.

## Consequences

- **Positive:** responsibility becomes a property of the substrate, not a prompt. A claim
  becomes an owned obligation with a deadline the agent cannot move and a closure it cannot
  fake.
- **Additive, not a refactor.** `lib/commitments.ts` and `lib/obligation-monitor.ts` are new
  modules composing existing primitives (Arbiter, resurrection, claim-tree, bonds). The only
  prerequisite that is architectural is ADR-0040.
- **Honest ceiling.** This proves a promise was *closed against an oracle on a clock the
  agent did not set*. It does **not** prove the work was *good* — pair it with adversarial QA;
  never sell the ledger as proof of quality.

## References

- `whitepaper/research/program/archive/accountability/agent-accountability-proposal.md` (the five laws; 46→29→1)
- ADR-0040 (non-forgeable actor identity — prerequisite)
- ADR-0022 (actor-souls), ADR-0033 (roadmap-pop / the named TTL gap), ADR-0038 (claim-tree)
