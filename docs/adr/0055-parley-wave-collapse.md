# 0055. Parley — Forced Reconciliation (Wave Collapse) for Overlapping Agents

## Status

Proposed — 2026-06-12

Numbering note: 0051 is claimed by PR #316 (marketplace protocol), 0053 by
PR #366 (out-of-band enforcement), 0054 by PR #368 (release cadence). 0055 is
the lowest free number at time of writing.

## Context

The operator's ask, verbatim (2026-06-12):

> I want a real parley. I want agents working on similar things to be forced
> to message or subscribe to a chat or SOMETHING. Or maybe when unspider sees
> redundancy or contradiction, we force them to parley to reconcile a single
> outcome? Wave collapse?

This is the *enforcement* half of the suggestibility programme. The detection
half is already designed: the **Spider** (ADR-0031 — *the cartographer's
surface→feature crawler*), the **unSpider** (ADR-0032 — *the
contradiction-finder that walks the same index looking for claims that cannot
all be true*), and the **suggestibility layer** (ADR-0039 — *a periodic
topical classifier that notices two live agents working the same surface and
proposes a group chat*). All three are unimplemented. ADR-0039 is explicitly
*coaching*: it proposes, it never compels. The operator is now asking for the
stronger thing — when the substrate sees redundancy or contradiction between
live agents, conversation stops being optional.

What we can build this from today, all shipped:

| Primitive | Where | Role in a parley |
|---|---|---|
| Actor inbox + attention | `lib/agent-inbox.ts`, `lib/attention.ts` | Delivering the summons |
| Tube channels | `lib/tube.ts` | The parley venue |
| Performative envelope | `lib/ipc-types.ts`, `lib/ipc-frame.ts` (ADR-0047) | Typed `propose`/`agree`/`refuse` turns |
| File claims + claim-watcher | `lib/sessions.ts`, `lib/claim-watcher.ts` | The shipped overlap signal (trigger v1) |
| Arbiter | `lib/arbiter.ts` (ADR-0045) | Making "ship the contested surface" unreachable |
| Coast Guard rent | `lib/coast-guard/compulsion.ts` (ADR-0050 ph7) | Pricing silence: ghost the parley, lose the sandbox |
| Durable commitments + monitor | `lib/commitments.ts`, `lib/obligation-monitor.ts` (ADR-0041) | Recording the collapsed outcome and watching adoption |

The gap is purely compositional: nothing today *forces convergence* when two
live agents hold divergent intents over one surface. Claims are advisory.
Suggestions (where they exist at all) are dismissible — and the one shipped
suggestion surface, `fleet_suggestions` (PR #322, `lib/transcripts.ts`, drained
by `pd suggest`), is a **Tender→operator** queue about *ship health*, not an
**agent↔agent** channel about *contested work*. Parley needs its own table and
its own state (`lib/parley.ts`); it is not an extension of `fleet_suggestions`.
The two never share a row, though a future Tender could *raise* a parley the
same way a detector does (trigger T2). The known failure is 2026-05-19:
three agents on the same dispatch-coordination surface discovered each other
by accident, after the duplicate work was done.

### The wave-collapse framing, taken seriously

Two agents claiming one surface is a **superposition**: the repo holds two
incompatible futures at once. That is fine — and often *desirable* (parallel
prototyping is a stated project value) — right up until one of them tries to
**publish**. Publication is the measurement. The design rule that falls out:

**Divergence is free. Publication requires collapse.** We never block agents
from *thinking* differently on the same surface; we block the contested
surface from *landing* until the parties have reconciled to a single recorded
outcome.

## Decision

A **parley** is a typed, terminating, enforced dialogue between the live
sessions whose intents conflict over a named surface. It composes the shipped
primitives above and adds one new module.

### Lifecycle

```
trigger ──> SUMMONED ──all parties respond──> CONVENED ──unanimous agree──> COLLAPSED
               │                                  │
               │ TTL expiry / party dead          │ round budget / TTL exhausted
               ▼                                  ▼
            VOIDED (salvage path)             ESCALATED (operator attention queue)
```

1. **Trigger.** Pluggable sources, ordered by what ships today:
   - **T0 — operator:** `pd parley call --surface <path|symbol> --with <session...> --reason <text>`.
   - **T1 — claim overlap:** `lib/claim-watcher.ts` observes two active
     sessions claiming intersecting file regions → auto-summon (debounced,
     deduped by `(surface, party-set)`, with a cooldown so re-claims don't
     re-summon).
   - **T2 — detectors (later):** unSpider contradiction findings (ADR-0032)
     and suggestibility topical matches (ADR-0039) emit the same trigger
     event. The parley is the *consumer* those ADRs were missing.

2. **Summons.** The daemon creates the parley row and a dedicated tube
   channel `parley:<id>`, force-subscribes each party, and posts a summons to
   each party's inbox. `pd attention` (already wired into SessionStart)
   surfaces it. A summons is not a suggestion: from this moment the party is
   **in arrears** with the Coast Guard rent evaluator until it responds.

3. **Freeze (the superposition lock).** While a parley on surface *S* is
   open, the Arbiter holds an invariant: **no party may land a commit
   touching *S***. Checked where note-per-commit already is — the
   Coordination Guard at commit time. The refusal message points to the
   parley channel and nothing else (per the no-advertised-bypass rule,
   `feedback_guardrails_never_advertise_bypass`). The freeze is scoped to
   *S* and to the parties — the rest of their work, and the rest of the
   fleet, is untouched.

   **Honest scope of the freeze.** The commit-time guard is *in-band* —
   inside the agent's own process — and ADR-0053 (out-of-band enforcement,
   PR #366) is explicit that in-band enforcement is **advisory by
   construction**: a determined agent escapes it with `PD_SHIM_OFF=1`, an
   absolute `/usr/bin/git` path, or a direct libgit2 write. So the in-band
   freeze stops a *cooperative* agent today; it does not bind a malicious
   one. The freeze becomes structurally unbypassable only when the same
   `(open parley on S) ⇒ refuse commit on S` predicate is also evaluated
   **out-of-band at the push-broker** (ADR-0053's branch-protection +
   App-push-broker layer). Parley's freeze is therefore specified as one
   predicate checked in *both* places — degrading gracefully to advisory
   in-band until #366 lands, and inheriting real teeth the moment it does.
   The tooth that bites a bypasser *today* is rent (point 6 / the rent
   tooth below), not freeze.

4. **The dialogue.** Turns on `parley:<id>` carry ADR-0047 performatives
   (**FIPA ACL** — *the standard performative vocabulary: `propose`,
   `agree`, `refuse`, `cfp`, `failure`, `cancel`*; Bellifemine et al. 2007).
   Minimal protocol, deliberately smaller than Contract Net (**Smith 1980** —
   *announce → bid → award*), because the task is reconciliation, not
   dispatch:
   - Each party must `propose` its intended outcome within the response TTL.
   - Bounded critique/revise rounds (default 3).
   - **Termination is unanimous `agree` among live parties** on exactly one
     proposal. Majority voting is wrong here: the outcome must be *adopted*
     by every party, and an outvoted agent that doesn't believe the outcome
     will Goodhart it. A party that cannot agree says `refuse` with reasons —
     which fast-forwards to escalation, never to deadlock.

5. **Collapse.** The agreed outcome is written as a **durable commitment**
   (ADR-0041, `lib/commitments.ts`): the winning intent, the superseded
   intents, the per-party obligations (rebase onto the winner / down-scope a
   claim / abandon a branch — *demote, never delete*, per
   `feedback_never_delete_demote_instead`), and a deadline.
   `lib/obligation-monitor.ts` watches adoption. The Arbiter lifts the freeze
   on *S* only once the commitment exists. Every turn was already an
   immutable note — the parley is its own audit log.

6. **Non-happy paths, all terminating:**
   - **Silence** past the response TTL → rent breach → the standard ADR-0050
     ph7 consequence chain (blocked commits, then reclaim eligibility). You
     cannot ghost a parley and keep the sandbox.
   - **Round/time budget exhausted or `refuse`** → **ESCALATED**: lands in
     the operator Attention Queue (ADR-0046) with the full transcript and
     each side's last proposal. Human collapses the wave. The freeze holds.
   - **Party dies** (session TTL, salvage) → **VOIDED**: surviving party is
     released, the dead party's intent enters the normal salvage path.

   This satisfies ADR-0047's own demand: termination logic, not hope. Every
   parley provably ends in one of {COLLAPSED, ESCALATED, VOIDED}.

### Why "forced" is real and not theater

Three escalating teeth, each already shipped as a mechanism — ordered by how
hard they are to escape:

1. **Attention** — the summons is in your SessionStart surface (you saw it).
   Notice, not enforcement.
2. **Freeze** — the contested surface will not land while the parley is open.
   *In-band today = advisory* (a cooperative agent stops; a bypasser doesn't,
   per ADR-0053); *unbypassable once the same predicate is checked out-of-band
   at the push-broker* (#366).
3. **Rent** — silence is priced; ghosting the parley costs the Coast Guard
   sandbox. This is the tooth that binds even an agent who bypasses the
   freeze, because the sandbox is granted at the OS layer (ADR-0050 ph0,
   Seatbelt/Landlock) and rent is verified at discharge time outside the
   agent's process (the discharge-macaroon protocol on `enforcement:dom-daddy`).
   You can outrun an in-band check; you cannot outrun losing the box you run in.

This is the same mechanism-design posture as ADR-0050 phase 7: don't ask
nicely, price the dark lane. The Nash-equilibrium move becomes *talk* — and
crucially it holds even against a non-cooperative agent, because the binding
tooth (rent) lives below the agent, not inside it.

## Considered Options

- **A. Advisory suggestions only** (ADR-0039 as written). Rejected as the
  *complete* answer: coaching has no teeth; the 2026-05-19 triple-overlap
  happened with all of today's advisory surfaces theoretically available.
  ADR-0039 remains valuable as a *trigger source* (T2).
- **B. Hard exclusion** — first claim wins, later claimants blocked outright.
  Rejected: kills parallel prototyping (a stated project value), and is
  simply wrong for *contradictions*, where neither side should silently win.
- **C. (chosen) Parley** — divergence stays free; publication requires
  collapse; the conversation is summoned, typed, bounded, and priced.

## Implementation Matrix (the build DAG)

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0055-phase-0-parley-core | now | — | `lib/parley.ts` (table + state machine SUMMONED→CONVENED→COLLAPSED\|ESCALATED\|VOIDED), `routes/parley.ts`, `pd parley call/list/show/respond/resolve`, tube channel + inbox summons, manual trigger (T0). **Done when:** the operator can summon two live sessions and the parley reaches a recorded terminal state, end to end, with tests under the real runtime (bun:sqlite). |
| 1 | adr-0055-phase-1-surface-freeze | next | 0 | Arbiter invariant + Coordination Guard check: an open parley on *S* refuses party commits touching *S*, refusal copy points only at the parley channel. In-band only at this phase (advisory per ADR-0053); the out-of-band push-broker check is folded in when ADR-0053/#366 lands. **Done when:** a party's commit on the contested path is blocked with a summons pointer, and lifts on collapse. |
| 2 | adr-0055-phase-2-rent-integration | next | 0 | `compulsion.ts` rent component: summons unanswered past TTL = arrears → the existing consequence chain. **Done when:** ghosting a parley measurably costs the sandbox in a CI-wired test. |
| 3 | adr-0055-phase-3-claim-overlap-trigger | — | 0 | T1: claim-watcher auto-summons on intersecting claims, with debounce/dedup/cooldown. **Done when:** two sessions claiming the same file get summoned with zero operator action, and re-claims do not spam. |
| 4 | adr-0055-phase-4-collapse-commitments | — | 0 | Outcome → ADR-0041 commitment with per-party obligations + deadlines, obligation-monitor watching adoption; Arbiter unfreeze keyed on commitment existence. **Done when:** a collapsed parley leaves a monitored commitment and an un-adopted obligation surfaces as a breach. |
| 5 | adr-0055-phase-5-detector-triggers | backlog | 3, ADR-0032, ADR-0039 | T2: unSpider contradictions and topical-classifier matches emit parley triggers through the same pipeline. **Done when:** a detected contradiction between two live sessions opens a parley with the finding attached as the opening exhibit. |

## Consequences

- ADR-0031/0032/0039 get the consumer they lacked: detection now has a
  defined, enforced downstream instead of a dismissible toast.
- ADR-0047 gets its first end-to-end *protocol pattern* in production: a
  bounded, typed dialogue with real termination.
- The freeze adds a new way for a commit to be refused. Scoping it to
  (surface × parties × open parley) keeps the blast radius minimal, but the
  guard copy must be excellent — a confused agent in a frozen lane is the
  main UX risk.
- Parley spam is the main mechanism risk; debounce/dedup/cooldown in phase 3
  are load-bearing, not polish.
- N-party parleys (3+) are supported by the same unanimity rule; if live
  experience shows convergence stalls at N≥3, escalation budgets can tighten
  with party count rather than weakening unanimity.
