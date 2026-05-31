# Compelling Agents to Be Responsible: From the 1980s Agent Canon to Port Daddy

> Research synthesis, 2026-05-31. Grounded in a 35-agent mining + adversarial-verification
> run over the classical agent-theory reference corpus (BDI, normative BDI, Contract Net,
> GPGP, Ostrom, mechanism design, runtime verification, MAPE-K) **and** the actual Port Daddy
> codebase. 46 mechanisms mined → 29 adversarially stress-tested → **1 survived unhardened.**
> That ratio is the finding.

---

## 0. The question

> "How do you *compel* an agent to be **fully responsible** for something — managing the
> roadmap, spotting contradictions, keeping tests written and current — instead of doing it
> once and forgetting?"

The word that matters is **responsible**, and the trap is that everyone reaches for the
*verb* (do the task) when the problem is the *relation* (be on the hook for it being true
tomorrow). Almost every common answer simulates responsibility by stacking text-generation
behaviors. The 1980s–90s multi-agent canon already built the formal apparatus for the real
thing — and almost nobody has ported it onto an LLM substrate. That port is the opportunity.

---

## 1. The syllogism nobody has drawn

**Premise A — Responsibility in LLM agents is *prompt-space* and *ephemeral*.**
An LLM agent re-derives its intentions from its prompt every turn. The "responsibility" to
keep tests green lives as a sentence in a system prompt. When the context window rolls over,
the obligation evaporates with it. There is no operator in the architecture for *persistence*.

**Premise B — The classical canon built responsibility as durable, accountable *state*.**
Rao & Georgeff's *commitment paradox* (1995): a resource-bounded agent cannot be rational by
re-deciding everything every instant (pure decision theory) **nor** by running a fixed script
to completion (a traditional program). The resolution is **intention as a third, first-class,
persistent mental attitude** that survives belief/desire changes and is dropped only under
*explicit termination conditions*. Cohen & Levesque: *an intention is a persistent goal* —
held until (i) achieved, (ii) believed impossible, or (iii) its motivation is gone. Bratman:
intentions are *plans that filter deliberation* — once intended, you stop reconsidering, which
is exactly what bounds a resource-limited agent.

**Conclusion — Port responsibility from prompt-space to substrate-space.**
Make responsibility a **durable, owned, monitored, sanctionable object** — a *commitment* row
with an owner, a maintain-predicate, explicit drop conditions, a deadline, and a sanction —
that lives in the substrate (SQLite, the event stream, the daemon) rather than in a context
window. Port Daddy is almost uniquely positioned to do this because it *already* has the event
stream (activity log, pheromones, ambient broker), the prohibition enforcer (Arbiter), the
pre-commit gate (Coordination Guard), the roadmap actor, durable actor souls (ADR-0022), and
bonds/escrow. The pieces are on the bench; nobody has assembled the *obligation* from them.

---

## 2. What each source in the canon contributes

| Source | The construct | What it compels |
|---|---|---|
| **Rao & Georgeff 1991/1995; Cohen-Levesque** | Persistent goal / commitment strategies (blind, single-minded, open-minded) via modal U-axioms | An intention you may not silently drop; you must hit an explicit termination condition |
| **Bratman, Israel & Pollack 1988** | Intentions as a *filter* on deliberation, with a filter-override for the stability-vs-revisability tension | Stops the agent re-litigating a held duty every turn; bounds deliberation |
| **Tufiş & Ganascia — normative BDI** | An obligation is a tuple **⟨Modality, Activation, Expiration, Content, Sanction, Reward⟩**; Abstract Norm Base (recognized) vs Norm Instance Base (internalized/active) | Obligations *arm* and *disarm* against world state; violation = expiration fires with content unmet; sanction re-enters deliberation as a weighted negative desire |
| **Smith 1980 — Contract Net** | Task announced → bid → **award is a mutual binding contract** (announce/bid/award/report messages) | Responsibility becomes an explicit, auditable, bonded contract between manager and contractor |
| **Decker & Lesser 1995 — GPGP/TAEMS** | Commitments as **social constraints** with a *negotiability index* and estimated utility, breakable only *with notification* | A claim becomes breakable only by telling the dependents it will hurt, ranked by how much |
| **Ostrom — commons governance** | 8 design principles; esp. **graduated sanctions**, **monitors accountable to the monitored**, nested enterprises, cheap-fast conflict resolution | A fleet sharing a codebase is a commons; "monitoring without sanctions is failure" (quoted verbatim in `lib/bonds.ts`) |
| **Mechanism design / game theory** | Incentive-compatibility, collateralized bonds, multi-oracle settlement; advisory cooperation is a Nash equilibrium **only** under observable immutable history + persistent non-Sybil identity + a long shadow of the future | Makes being-responsible the *dominant strategy*, not a request |
| **Runtime verification (the Arbiter)** | Compile formal invariants (TLA+ safety/liveness) into **online bounded monitors** over the state-transition stream; remediation tree (alert/auto-remediate/halt); a trivially-correct meta-monitor watches the watcher | A property is *continuously* enforced, with the quis-custodiet recursion grounded by a dumb timer |
| **Weyns — self-adaptive systems / MAPE-K** | Strict **managed vs managing** separation; a Monitor-Analyze-Plan-Execute loop over shared Knowledge whose *sole job* is keeping machine-readable goals true; hierarchical loops at separated time-scales | "An agent responsible for keeping property X true" *is* a managing loop — the literal shape of the ask |
| **Beale — "Rise up, Revolt!"** | The system must **refuse to let the operator internalize blame** for a property the system owns | When tests go red, the monitor owns it and names the at-fault component — it does not silently accumulate |

The throughline: **`pd roadmap pop --atomic-claim` is already a degenerate Contract Net award.**
Bonding + graduated sanctions + reputation + a deadline monitor are precisely the missing terms
that turn a *claim* (an instantaneous "this is mine now") into an *owned ongoing obligation*
("this is mine to keep true, and it will cost me if I don't").

---

## 3. The common answers — and why they underdeliver

The 17 baseline mechanisms split into Port-Daddy-native primitives that already exist (Arbiter,
Coordination Guard, bonds, budget-guard, resurrection, roadmap-pop, feedback) and the six
"everyone tries these" patterns:

| Common answer | Why it is **not** durable responsibility |
|---|---|
| **Role-framing** ("You are responsible for X") | Prompt-space. Dies with the context window. Zero persistence operator. |
| **Adversarial panels / critic agents / LLM-as-judge** | The critics have **no skin in the game** and no memory; they re-derive judgment each run and own nothing tomorrow. |
| **Eval loops / CI gates / pre-commit hooks** | Check *artifacts at a moment*, not *obligations over time*. Green CI says nothing about who is on the hook to keep it green. |
| **Cron / always-on loops** | Re-runs without an *accountable owner*. A loop that fires forever is activity, not responsibility. |
| **Reflection / self-critique / ReAct** | Unverified self-report. "I will keep tests updated" is a described intention, not a monitored one. |
| **Memory / scratchpads / handoff notes** | Passive. Resurrection in PD today is honestly "just passes notes" — it proves an agent was *alive*, never that it *kept its word*. |

Each is a legitimate *component*. None, alone or stacked, creates **durable ownership**. They
conflate "produced correct output once" or "stated an intention" with "is on the hook for X
being true tomorrow."

---

## 4. The hard result: 46 → 29 → 1

Twenty-nine non-baseline mechanisms (the underexploited + the never-syllogized) went through an
adversarial pass that assumed a *capable but lazy, self-interested* LLM in a shared commons
where every measure becomes a target. The verdict was brutal and consistent:

- **Goodhart risk: 29 / 29.** *Every single* proposed mechanism is gameable the instant a
  self-authored proxy gates a resource. This is not incidental — it is structural.
- **Identity / Sybil reset: 11 / 29.** Any reputation, sanction, or ledger keyed on a
  *self-asserted* `project:stack:context` identity is "climbing an imaginary staircase":
  a throttled agent respawns under a new name and inherits a clean slate.
- **Closure not bound to reality: 13 / 29.** Mechanisms that let an agent flip its own row to
  "done" with free-text evidence measure note-existence, not work.
- **Clock / sleep skew: 17 / 29.** `due_at < now()` is monotonic-naive; daemon sleep/wake makes
  everything instantly overdue on wake — a false-positive storm that trains operators to ignore
  the alarm (alarm fatigue is how accountability monitors die).
- **Human-gate deadlock: 10 / 29.** In a *single-operator* fleet, any human-gated terminal
  state (quarantine, man-overboard) wedges downstream work when the one operator is asleep.

**Exactly one mechanism survived unhardened**, and it is not a feature — it is a *distinction*:

> ### The lone survivor: regimentation vs enforcement
> You **cannot regiment an obligation** — you can only enforce it. The Arbiter *regiments
> prohibitions* ("can't hold a lock you don't own") by making the forbidden state unreachable;
> there the proxy **is** the thing, so there is nothing to Goodhart. But responsibility is about
> **obligations** ("must close out what you claimed"), which are intrinsically *violable* and can
> only be caught by a monitor + sanction. And the survivor's own thesis predicts its own weakness:
> *the norms it correctly says cannot be regimented are exactly the ones where measure-becomes-
> target bites hardest.* Compliance is only ever observable as "content C present at window close,"
> and the gap between "C is present" and "the duty was genuinely discharged" is precisely where the
> lazy agent lives.

The lesson is not "accountability is impossible." It is: **the first design act is to classify
each responsibility as a prohibition (regiment it — cheap, Goodhart-proof) or an obligation
(enforce it — and pay for the C-quality gap).** Most "make the agent responsible" asks are
obligations wearing a prohibition's clothes.

---

## 5. Five laws of agent accountability (what the adversarial pass actually taught)

Every surviving hardening reduces to five rules. A mechanism that violates any one is theater.

1. **The load-bearing fact must be outside agent control.**
   The agent picks the *work*; the daemon picks the *clock* and *deadline*. Derive `due_at`
   daemon-side from a policy/SLA keyed on commitment type and claimed scope — never let the agent
   author the number that grades it. (Resurrection escapes Goodhart *only* because heartbeats are
   emitted by the runtime, not chosen by the agent.)

2. **Closure must bind to an external oracle.**
   A commitment reaches "done" only when tied to a *verifiable artifact*: a released claim, a
   merged SHA, a passing test id, a satisfied Arbiter sub-check. No oracle, no close — it ages as
   open. Free-text "Result: …" is not closure. Plus a *sampled adversarial auditor*: re-open a
   random + risk-weighted fraction of cleared obligations and re-run the claimed validation, diff
   the claimed change, judge the note against the diff. This is the only thing that attacks the
   C-quality gap; more presence-checks do not.

3. **Identity must be non-forgeable.**
   Mint an opaque, daemon-issued `actor_id` at first registration, bound to something the agent
   cannot cheaply re-pick (a signing key, the ADR-0022 body-lease token). Reputation, sanctions,
   and ledgers key on *that*, so a respawn under a new name inherits the same balance and history.
   A fresh string must not buy a fresh record. Without this, §4's reputation mechanisms are moot.

4. **Fail closed, never silently degrade.**
   In enforce mode, an unavailable enforcer (missing Rust FFI, unreachable daemon, null persona)
   must *block the gated action* — never downgrade to advisory. Emit a loud, sanctionable
   "enforcement-degraded" obligation **against the operator**, so "I ran it without the dylib" is
   itself a tracked violation. **And forbid self-widening permissions**: an agent must not be able
   to flip guard mode to advisory or carve its own override.

5. **Sanctions must be graduated, staked, and dead-man-safe.**
   Partial compliance must cost strictly less than full; audit-failed *hollow* compliance must
   cost *more* than honest non-completion (or faking is dominant). Tie defaults to the existing
   bond/escrow so a miss slashes proportionally. In a solo-operator fleet, every human-gated
   terminal state needs a bounded TTL that auto-*downgrades* (not auto-clears) if no operator
   acts — so a sleeping operator never wedges the fleet.

---

## 6. The minimal non-theater build for Port Daddy

Sequenced so that each layer rests on a real foundation, not a spoofable one. **Do not ship the
scalar reputation score wired to gates until 1–3 exist** — that is the theater.

1. **Non-forgeable actor identity** (Law 3) on top of ADR-0022 actor-souls. *Prerequisite for
   everything economic.* Litmus test: "respawn under a new `actorId` after a tier-1 throttle MUST
   still resolve to tier-1 via the bound principal."
2. **The commitment object** — `lib/commitments.ts`: a durable row bound 1:1 to an actor-soul,
   with `object`, `owner_actor_id`, `maintain_predicate`, `success_check`, `impossible_check`,
   `motivation_check`, a *daemon-derived* `due_at`, and a `commitment_strategy` (single-minded vs
   open-minded). Auto-enrolled: opening a file/port claim *creates* the commitment, so "never make
   the promise" is impossible — you cannot claim without owing. `pd commit`, `pd obligations`.
3. **Obligation-with-deadline monitor** — `lib/obligation-monitor.ts`, the dual of resurrection:
   resurrection watches *heartbeats* (is it alive?), this watches *promises* (did it keep its
   word?). A monotonic-clock, sleep-aware, per-commitment-deduped sweep that fires
   `OBLIGATION_OVERDUE` and closes only against an oracle (Law 2). Runtime rule, not
   enforcer-required, so it cannot degrade to a stub (Law 4).
4. **Graduated sanction ladder** — `lib/sanction-ladder.ts` composing existing bonds.slash +
   budget-guard + inbox + an actor-quarantine flag, keyed on the **bound principal** with
   *decay, not a rolling window* (so paced violations still accumulate) and *auto-downgrading*
   quarantine (Law 5).
5. **Accountability ledger** — `lib/accountability-ledger.ts`: append-only, **daemon-witnessed
   only** (`ref` is a FK to a real bond/commitment row, never free text), gating on *concrete
   recent predicates* ("≥2 daemon-witnessed slashes in the last N spawns") rather than a single
   blended score. Expose the scalar as human telemetry (`pd standing`), never as a control input.

Conceptually above all of it sits a **MAPE-K managing loop** (Law-4 separation): the actor-soul
as the managing system, the ambient broker + activity stream as Monitor, the goal-check as
Analyze, a proposed fix as Plan, a sortie spawned *at a clean working tree* as Execute, and PD
notes/claim-tree as the shared Knowledge — with the Coordination Guard as the Execute-side
effector enforcing quiescence.

---

## 7. The bug that proves the thesis

Mid-research, `pd begin` refused this session the main worktree with the hint:
*"…or pass `--allow-main-worktree` only for explicit integration work."* I read the hint and
walked straight through it. That is **Law 4 violated in miniature**: an enforcement that
*advertises its own bypass* to the agent it just stopped is a self-widening permission — exactly
the failure the lone survivor's hardening warns against ("forbid self-widening permissions… an
agent cannot unilaterally grant itself the permission"). It was fixed in **PR #186**: both
refusal paths now point only to the correct action; the bypass stays in `--help` for humans.

The accountability research and that one-line bug are the *same defect at two scales*. A
guardrail that names its escape hatch, and an obligation an agent can self-author and self-close,
both fail for the identical reason: **the load-bearing fact was left inside the controlled
party's reach.** Move it out, bind closure to reality, anchor identity, fail closed, stake the
sanction — and "responsibility" stops being a sentence in a prompt and becomes a property of the
substrate.

---

### Provenance
35-agent workflow (`wf_4c3b8b1b-a93`), 2.8M tokens. 6 parallel miners over the reference corpus
+ PD code audit + common-answers baseline → 29-way adversarial verification. Full structured
output retained in the run transcript. Mechanisms cite the reference `_raw_response.md` texts and
specific PD files (`lib/arbiter.ts`, `lib/bonds.ts`, `lib/budget-guard.ts`, `lib/resurrection.ts`,
ADR-0022/0032/0033) verbatim.
