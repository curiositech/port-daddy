---
license: Apache-2.0
name: runtime-verification-for-agents
description: >
  Designing runtime monitors for stated coordination properties, with explicit
  event coverage, uncertainty handling, and an independently controlled effect
  boundary where prevention is required. Monitoring evidence is scoped to the
  tested build, events, routes, and assumptions. NOT FOR application performance monitoring
  (use observability skills), log aggregation, static analysis, or unit testing.
category: Formal Methods & Verification
tags:
  - runtime-verification
  - formal-methods
  - arbiter
  - agent-coordination
  - monitors
  - invariants
---

# Runtime Verification for Agents

**Version:** 1.0
**Domain:** Formal Methods, Agent Coordination, Runtime Monitoring
**Lineage:** Port Daddy FORMAL_VERIFICATION_PLAN.md, Section 3 (The Arbiter)

## When to Use This Skill

Load this skill when:

- You have formal invariants (TLA+, Alloy, temporal logic) and need to enforce them at runtime
- You are building an agent coordination daemon and need continuous audit
- You are implementing the Arbiter pattern: an independent agent that monitors others
- You need to decide between synchronous checking and sampled checking
- You are debugging false positive cascades in your monitoring layer
- You need to handle the "who watches the watchman" recursion

Do NOT load this skill for:
- **Application performance monitoring** -- use observability/APM skills
- **Log aggregation** -- use ELK/Loki/Datadog skills
- **Static analysis** -- use linting/type-checking skills
- **Unit testing** -- use TDD skills; runtime verification is complementary, not a substitute

## Core Concept: The Arbiter

The monitor reads a defined event/state stream and emits `PASS`, `VIOLATION`, or
`UNKNOWN/INDETERMINATE` for a versioned property and snapshot. Missing events,
stale snapshots, ambiguous event order, or monitor failure are unknown, not
healthy. An alert-only monitor is detect-only. An effect is blocked only if an
independent controller checks the fresh verdict at the actual effect edge and
owns every in-scope route; inventory and fault-test bypasses before claiming
prevention. See [monitor/effect boundary](diagrams/research-r01-observe-decide-mediate-witness.md).

## Decision Workflows

Select synchronous, sampled, or event-driven observation from the property,
coverage, event-loss model, delay tolerance, and measured local cost. These are
implementation choices, not universal latency defaults. A timeout alone does
not prove a process crashed; check authoritative identity/health state and retain
uncertainty when the observation is incomplete.

- [Select monitor mode from risk and route coverage](diagrams/research-r02-choose-monitor-mode-from-risk-and-boundary.md)
- [Respond to violations and uncertain evidence](diagrams/research-r03-violation-response-with-uncertainty-branch.md)
- [Separate event time from ingest time](diagrams/research-r04-event-time-ingest-time-and-late-telemetry.md)
- [Remediate slow monitors without silent weakening](diagrams/research-r05-slow-monitor-remediation-without-weakening-safety-silently.md)
- [Recover from monitor crash](diagrams/research-r06-monitor-crash-and-recovery-contract.md)

Use an explicit contract: property/version, event sources and coverage, clock/order assumptions, missing-event behavior, monitor health, decision latency, effect controller, bypass inventory, witness, and observed result. If a monitor is detect-only, report the alert and the observed effect separately; do not relabel detection as prevention.

## Trace-Checking Algorithms

| Approach | Latency | Memory | Use Case |
|----------|---------|--------|----------|
| **Online (streaming)** | Per-event decision opportunity | implementation/property dependent | Synchronous monitors |
| **Offline (batch)** | Post-hoc | trace representation and checker dependent | Audit, forensics |
| **Bounded online** | Per-event decision opportunity | window, property, and implementation dependent | Sliding-window properties |

For agent coordination, choose bounded online only when event coverage and decision delay are sufficient for the property. Safety preconditions at an effect edge may need synchronous checks; retrospective/liveness analysis may be sampled or batch. Complexity depends on the monitor state and property, not these labels; measure the pinned implementation.

**Illustrative measurement worksheet** (not a default or imported claim):
- Record per-request and sweep costs under the local workload.
- Compare monitored and unmonitored behavior; publish the resulting distribution, not a borrowed threshold.

## Worked Example: Compiling NoteMonotonicity

### State invariant versus action property

In TLA+, a state invariant is a predicate checked in each reachable state; an
action property relates the before and after states of one transition. These
claims need different monitor inputs. The URL [TLA+ state-predicate definition](https://lamport.azurewebsites.net/tla/rhtml/state-predicate.html)
and Lamport's [high-level overview](https://lamport.azurewebsites.net/tla/high-level-view.html)
were checked for these distinctions.

Model `monitored` as the set of session IDs with a verified baseline for one
immutable session generation. A verified closure retires that generation by
removing its ID from `monitored`; reusing an ID requires a different generation
and a new explicit baseline receipt. The state predicate is:

```tla+
ActiveNoteCountAtLeastBaseline ==
  \A a \in monitored :
    IF sessions[a] = NULL THEN TRUE
    ELSE IF sessions[a].status = "active"
      THEN sessions[a].generation = baselineGeneration[a]
           /\ Len(sessions[a].notes) >= baselineCount[a]
      ELSE TRUE
```

For transitions that remain within the same active generation, the action
property is:

```tla+
IsTrackedActive(s, a) ==
  IF s[a] = NULL THEN FALSE
  ELSE s[a].status = "active"
       /\ s[a].generation = baselineGeneration[a]

NoteCountDoesNotDecrease ==
  \A a \in monitored :
    IF IsTrackedActive(sessions, a) /\ IsTrackedActive(sessions', a)
      THEN Len(sessions'[a].notes) >= Len(sessions[a].notes)
      ELSE TRUE
```

The conditional guards avoid treating Boolean conjunction as a short-circuit field-access operator. Assume every monitored ID belongs to both state-function domains and every non-`NULL` value has the declared fields. These are specification fragments, not a TLC-checked module. The scope is explicit: this formula
checks active-to-active transitions. Retirement is a separate action permitted
only after verified closure evidence; a newly opened generation is enrolled as
a new baseline epoch. Monitoring the action property requires a trustworthy
before/after pair for each covered transition, or a complete enough trace to
reconstruct it. A sampled snapshot can check the state predicate against its
pinned baseline but cannot show that no decrease happened and was repaired
between samples. Counts do not establish note identity, authorship, ordering, or
append-only integrity: replacing one note with another leaves the count
unchanged. Those stronger claims need stable note IDs and an authoritative append
journal or equivalent transition evidence.

The runnable local monitor contract and fixtures are in
[the note-count monitor reference](references/note-count-monitor.md),
[its zero-effect adapter model](examples/note-count-monitor.mjs), and
[its tests](tests/note-count-monitor.test.mjs). The adapter validates count and
revision shapes, generation binding, and verified baseline/closure receipts.
It does not implement daemon storage, cryptographic receipt validation, or
pre-effect control; those remain responsibilities of a real source/effect
adapter. Run the fixture tests with `node --test tests/note-count-monitor.test.mjs`.

### Step 1: Identify Violating Transitions

- `addNote()` -- a candidate transition, requiring observed before/after identity.
- `deleteSession()` -- a disappearance requires a separate presence/closure property; the active-to-active count formula alone does not cover it. Include this route in reconciliation.
- Direct SQL `DELETE/UPDATE FROM session_notes` -- bypasses an API-only observer unless the database/effect boundary mediates it.

### Corrected monitor contract

Do not silently seed a baseline. Baseline acquisition is an explicit operation
that requires a verified active-session binding and an authoritative committed
snapshot with a source revision. An absent, stale, or unbound baseline returns
`UNKNOWN`; zero is not a safe default. Each check must verify that the tracked
session still exists and is active in the same authority domain. A tracked
session missing from the current active-session set is a reconciliation finding,
not a healthy omission and not automatically a proven violation.

When a current count is lower than the last verified count, emit a
`VIOLATION` and retain the last verified baseline. Advancing it to the lower
count would hide repeated loss on later checks. Advance the durable baseline with an exact-prior compare-and-set only after
a valid, consistently read observation satisfies the monitored count property;
update in-memory state only after that persistence succeeds. A verified closure receipt may retire the baseline; a missing row or
status change without that receipt leaves the result `UNKNOWN`. Baseline
re-establishment must not overwrite an existing baseline silently; use an
explicit, audited reset protocol if the property or source generation changes.

Counts prove only count nondecrease over the covered observations. They do not
prove stable note identity or append-only integrity. A synchronous count query
is not universally cheap or safe: its cost and transaction consistency depend
on the database, indexes, contention, and request path. Measure the actual
adapter under the intended workload. A post-API observation is detect-only; to
prevent an effect, an independent controller must check a fresh decision before
dispatch on every in-scope route. Remediation is separately authorized and
must reconcile effect state; it must not automatically resurrect an agent.

### Step 2: Choose Strategy

Choose where to observe from the property, effect boundary, event coverage,
consistency needs, allowable decision delay, and measured cost. A check belongs
on the effect path only when prevention requires it and the controller can
obtain sufficient current evidence within the declared latency budget. A
background sweep can discover drift but cannot prevent an already completed
effect. There is no universal rule that an integer/count check is cheap.

### Steps 3–6: Implement, wire, and verify

Follow the [note-count monitor reference](references/note-count-monitor.md) for
the scoped adapter contract, baseline lifecycle, result handling, and injected
cases. Its local Node fixture is executable and zero-effect; it validates the
example semantics only. It is not a daemon integration or deployment proof.

## Failure Modes

### Failure Mode 1: Monitoring Overhead Kills Throughput

**Symptom:** p99 latency spikes after enabling synchronous monitors.

**Root cause:** Checks too expensive for the hot path -- multi-table JOINs,
full table scans, or checking all-session invariants per single-session op.

**Detection:** Track `check_duration_ms` per invariant. Compare against the preregistered local target and report its distribution.

**Remediation:** Measure the check against the declared safety requirement. If an expensive check guards a must-not-happen effect, retain a sufficient independent synchronous precondition at the effect edge and do the broader analysis asynchronously; do not silently downgrade the safety claim. See [slow-monitor remediation](diagrams/research-r05-slow-monitor-remediation-without-weakening-safety-silently.md).

**Prevention:** Set and preregister a local latency target before measurement; do not infer one from this example.

### Failure Mode 2: False Positive Cascades

**Symptom:** The monitor repeatedly reports a finding that cannot be reproduced
from the declared authoritative source, or an automated response harms a healthy
session.

**Possible causes:**
1. **Snapshot inconsistency:** the read spans an uncommitted or changing state.
2. **Stale monitor state:** a cache was not reconstructed from authority after restart.
3. **Identity/coverage mismatch:** the read binds a different session or source.
4. **Time-order ambiguity:** wall-clock event time was mistaken for sequence order.

A wall-clock adjustment by itself does not change a committed row count. Do not
attribute `NoteCountDoesNotDecrease` alerts to NTP without tracing the exact
source data and comparison logic. For time-sensitive properties, keep event
time and ingest time distinct and define the clock/ordering contract.

**Detection:** Re-run the same property against an independently obtained,
consistent authoritative snapshot. If evidence remains ambiguous, record
`UNKNOWN`; do not suppress or promote it to `VIOLATION` by guesswork.

**Remediation:** Reconcile the session binding, snapshot revision, and monitor
state. For destructive or externally visible responses, require a fresh
independent authorization and an effect-state check. Repeated checks can reduce
some stale-read errors, but do not substitute for a defined evidence contract.

### Failure Mode 3: The Watchman Crashes (Quis Custodiet)

**Symptom:** Arbiter dies/hangs. No invariants checked. Violations accumulate
silently. System believes it is monitored when it is not.

**Root causes:**
1. Unhandled exception in monitor code (malformed input -> SQL error)
2. Unbounded state growth (tracking every session ever, not just active)
3. Deadlock (monitor lock conflicts with daemon write path)

**Detection:**
- **Independent health witness:** choose a heartbeat and timeout policy from the failure model and service objective; timeout means suspected failure, not proof of crash.
- **Self-check:** treat a self-reported “I am running” signal as one witness only, not independent health evidence.

**Remediation:** Follow the deployment's bounded process-control policy. Preserve the prior monitor generation and trace, restart only under explicit authority, reconcile state before declaring healthy, and stop repeated restart loops at a locally defined circuit-breaker limit. See [monitor crash and recovery](diagrams/research-r06-monitor-crash-and-recovery-contract.md).

**Prevention:** isolate failures, bound monitor state with an explicit eviction/reconciliation policy, and observe monitor health through a separately described witness. A timer or self-reported timestamp is not independent evidence. Choose storage and scheduling from the deployment constraints.

## Anti-Patterns

**1. Checking Everything Synchronously.** Select synchronous, sampled, or offline evaluation based on the property, event coverage, acceptable delay, and measured cost. Some properties cannot be safely enforced by later sampling.

**2. Monitors That Mutate Monitored Application State.** Persisting the monitor’s own baseline and receipts is necessary bookkeeping; changing the application to repair a finding is a separate effect. Monitors observe and report. Remediation is
separate. A monitor that "fixes" violations is a participant, not an observer --
it introduces its own bugs and triggers other monitors.

**3. Unbounded Monitor State.** Define state retention, expiry, and restart reconstruction. Eviction is safe only when the property contract says the dropped history is no longer needed. Restore the durable baseline after restart; if it is unavailable, return `UNKNOWN` and reconcile rather than implying continuity from a fresh count.

**4. Alert Fatigue.** Define deduplication keys, escalation ownership, retention,
and delivery latency from the incident policy. Any aggregation window is a local
choice; it must not delay an alert required to hold an unsafe effect. Preserve
raw findings so summaries do not erase identity or audit evidence.

**5. Happy-Path-Only Testing.** Every monitor needs injection tests: direct SQL
bypassing API, concurrent races, clock manipulation, simulated crash recovery.

## Example finite-corpus evaluation plan

This is a planning template, not a universal acceptance gate. Preregister cases,
false-positive handling, workload, performance measure, crash/recovery scenarios,
and bounded-state criteria from the property and service risk. Report detection on
the named corpus separately from general correctness; a finite corpus cannot prove
all traces or all deployments.

## Compiling a supported, observable safety action property

1. **Identify state variables** referenced by the invariant
2. **Identify actions** that can modify those variables
3. **Per action**, preregister the decision-latency target and evaluate feasibility against the pinned workload
4. **Establish observability and a trusted baseline**, then compile the supported action relation into `(previous, current) -> Verdict`
5. **Wire** into action path (sync) or background sweep (sampled)
6. **Define independently authorized remediation**: log, alert, or controller-owned hold/reconciliation
7. **Write injection tests** that bypass the API
8. **Measure overhead** against the preregistered finite-corpus gates

### Port Daddy Invariant Reference

| Invariant | Strategy | State | Remediation |
|-----------|----------|-------|-------------|
| NoteMonotonicity | Baseline-bound action check or sampled state check; select from coverage and latency needs | Count plus session binding and source revision | Report decrease; hold only the affected mutation if an authorized effect controller owns it; reconcile before any recovery |
| EscrowInvariant | Check at each covered escrow transition if it guards an effect | Authoritative escrow state and transaction identity | Reject/hold the transition at its controller; alert alone is detect-only |
| CrashRecovery | Property- and service-objective-derived observation | Dead-agent evidence plus recovery transition | Reconcile before recovery; timeout alone means suspected failure |
| HeartbeatFreshness | Property- and service-objective-derived observation | Heartbeat identity, source, and ordering contract | Mark suspected stale; reconcile before consequential action |
| FileClaimConsistency | Check at each covered claim transition if it guards a conflict | Authoritative claim state and file/session binding | Reject/hold conflicting claim at its controller; alert alone is detect-only |

## The Arbiter as a Port Daddy Agent

This is a historical integration example, not an assertion about current daemon
behavior. If a deployment runs a monitor as an agent, specify who observes its
health, how the observation binds to the monitor generation, and what authority
permits recovery. A missed heartbeat yields suspected failure; it does not by
itself prove process death or authorize salvage. Reconcile the monitor's last
verified state before resuming protected decisions.

```bash
# Historical interface example only. Do not execute while the local Port Daddy
# runtime halt is active.
pd agent register --agent arbiter-001 \
  --identity myproject:arbiter:main --purpose "Invariant monitoring"
pd begin --agent arbiter-001 --purpose "Monitoring against formal invariants" --lifecycle durable
```

The monitor and any recovery service may share failure domains; inventory them. A timer is not ground truth. Document who observes the monitor, what evidence authorizes recovery, and the limits of that witness.

## Bundled Assets

- `examples/note-count-monitor.mjs` and `tests/note-count-monitor.test.mjs` — Zero-effect executable adapter contract and negative fixtures.
- `evals/evals.json` — Evaluation scenarios and quality-gate validation. Load when testing your monitor implementation against a preregistered finite injected-test corpus, workload-specific overhead targets, and a declared crash-recovery corpus. These examples are not known results or universal defaults.

## Evidence boundary

A runtime monitor detects; it prevents only when an independently controlled effect boundary consumes its fresh decision before dispatch and covers every in-scope route. Load `references/monitoring-and-enforcement.md` before describing a monitor as enforcement or planning an adversarial evaluation. The local Port Daddy runtime is halted: code snippets involving `pd` are illustrative historical examples only and must not be executed under the active halt.


See [source correction ledger](references/source-correction-ledger.md) for inherited thresholds and universal defaults removed from this draft.

## Research limits

Use [monitoring-boundary-and-evaluation](references/monitoring-boundary-and-evaluation.md) to write a property-specific coverage contract and finite-corpus evaluation.


Lamport's TLA+ material distinguishes state predicates from action relations and frames safety/liveness claims over behaviors. NIST SP 800-137 describes continuous monitoring as a risk- and system-context-dependent program. Schneider's runtime-enforcement source was accessed at abstract/source-identity depth only; it is used here only to motivate separating observation from enforcement, not to assert a specific implementation theorem. Chandra–Toueg's source was accessed at source-identity/research-summary depth; silence/timeout limits are presented as a model-dependent warning, not a deployment guarantee. None of these sources validates a universal poll interval, clock tolerance, monitor-latency budget, crash count, SQL cost, or effect-prevention claim for a particular deployment.

Sources: [Lamport, TLA+ high-level overview](https://lamport.azurewebsites.net/tla/high-level-view.html); [Lamport, state predicates](https://lamport.azurewebsites.net/tla/rhtml/state-predicate.html); [Schneider, 2000](https://doi.org/10.1145/353323.353382); [NIST SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final); [Chandra and Toueg, 1996](https://hdl.handle.net/1813/7192).

## Bundle navigation

[references index](references/INDEX.md).
