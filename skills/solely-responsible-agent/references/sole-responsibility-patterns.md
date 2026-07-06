# Sole-Responsibility Design Patterns — Literature Synthesis

Research synthesis (2026-06-10) across five threads: software ownership
patterns, autonomic computing, organizational/maritime role design,
multi-agent systems theory, and LLM-agent era practice. Load this when
you need the *why* behind the skill's design rules, or citations.

## 1. Autonomic computing: MAPE-K

Kephart & Chess 2003, *The Vision of Autonomic Computing*
(https://www.semanticscholar.org/paper/540e7510e92d8f24600eabd2e3ced700e31f1c23)
introduced the canonical responsibility loop for a managing element:

- **M**onitor the managed element
- **A**nalyze whether goals are violated or at risk
- **P**lan corrective action
- **E**xecute via a closed control loop
- **K**nowledge: a knowledge base underpinning all four phases

Key properties: the autonomic manager has *exclusive authority* over
its managed element; the knowledge base is the manager's *private
state* (metrics, learned parameters, failure history). A manager that
stops monitoring loses its claim visibly — the design makes
dereliction observable as degradation. Survey of descendants:
https://arxiv.org/html/2511.06352v1

## 2. Kubernetes controllers/operators: reconcile + ownership

The operator pattern codifies sole responsibility per resource type
(https://oneuptime.com/blog/post/2026-02-09-operator-reconciliation-loop/view,
https://sdk.operatorframework.io/docs/best-practices/common-recommendation/):

1. **Idempotent reconciliation** — re-running produces the same result.
2. **Level-triggered, not edge-triggered** — converge on *state*, not
   on replaying every event. A controller that was down catches up by
   observing current state; missed events don't create blind spots.
   This is the strongest argument for "cover the gap since the last
   ledger entry" over fixed polling windows.
3. **ownerReferences** — ownership is recorded in the system, enabling
   cascade cleanup and conflict detection. One controller per resource
   type, enforced by the platform, not by convention.
4. **State lives in the cluster, not the process** — operator restarts
   lose nothing; the next reconcile pass detects drift and corrects.

## 3. The single-writer principle & actor model

- Single-writer (Mechanical Sympathy,
  https://mechanical-sympathy.blogspot.com/2011/09/single-writer-principle.html):
  one entity exclusively mutates a piece of state; readers may observe.
  Eliminates races without locks. The responsibility analog: one agent
  exclusively *answers* its concern; others may consume the answer.
- Actor model (https://en.wikipedia.org/wiki/Actor_model): each actor
  owns private state, processes messages sequentially. Sole
  responsibility is also sole *authority* — the owner makes all
  decisions about its state.
- Database-per-service generalizes to database-per-agent
  (https://microservices.io/patterns/data/database-per-service.html):
  dedicated schema or table-namespace, access for others only via the
  owner's API/events. Enforce at the storage layer when possible;
  naming convention + review is the floor.

## 4. Maritime & military role design

The oldest working implementations of single-point accountability:

- **Commanding officer** (US Navy Regulations ch. 8,
  https://www.secnav.navy.mil/doni/US%20Navy%20Regulations/Chapter%208%20-%20The%20Commanding%20Officer.pdf):
  "The responsibility of the commanding officer for his or her command
  is absolute… delegation of authority shall in no way relieve the
  commanding officer of continued responsibility." Delegation expands
  governance scope; it never sheds accountability.
- **Officer of the watch + the deck log**
  (https://www.marineinsight.com/marine-navigation/different-types-of-entries-to-be-made-in-the-bridge-log-book-of-the-ship/):
  the OOW signs the log; original pages are never removed; the log is
  admissible evidence; entries are real-time or at defined intervals.
  The watch *handover* is itself a logged ceremony — brief the relief,
  record the briefing. This is the template for the mandatory-ledger +
  handover rules.
- **Incident Command System**
  (https://en.wikipedia.org/wiki/Incident_Command_System): exactly one
  Incident Commander; unity of command (everyone reports to one
  supervisor); span of control 3–7; mandatory resource check-in/out;
  documented action plans at defined intervals.
- **RACI** (https://project-management.com/understanding-responsibility-assignment-matrix-raci-matrix/):
  exactly one **A**ccountable per row. "When accountability is shared,
  it effectively disappears, as each person assumes the other is
  watching the outcome." The responsibility vacuum
  (https://arxiv.org/pdf/2601.15059): failure occurs when no entity
  simultaneously holds authority *and* capacity.

## 5. Multi-agent systems theory

- **GAIA roles** (Wooldridge & Zambonelli 2000,
  https://www.cs.ox.ac.uk/people/michael.wooldridge/pubs/jaamas2000b.pdf):
  a role = permissions + responsibilities (liveness "good things it
  must add" + safety "bad things it must prevent") + activities +
  protocols. Failures attribute to the role, enabling escalation and
  audit.
- **BDI belief bases**
  (https://en.wikipedia.org/wiki/Belief%E2%80%93desire%E2%80%93intention_software_model):
  each agent owns its belief base; every action traces to a belief and
  a committed intention. Desire/intention mismatch is a *detectable*
  inconsistency — the transparency that makes obligations auditable.
- **Social commitments** (Singh; https://www.mdpi.com/1999-4893/12/4/76):
  responsibility formalized as debtor→creditor commitments. Compliance
  via **regimentation** (violations impossible), **enforcement**
  (detect + sanction), or **ostracism** (peers refuse interaction).
- **Electronic institutions**
  (https://www.iiia.csic.es/~jar/papers/2006/andres-aamas-2006-2.pdf):
  norms operationalized as rules + monitoring predicates + sanctions.
  An obligation without a monitoring predicate is aspiration.

## 6. LLM-agent era practice (2024–2026)

- **MemGPT → Letta** (https://www.letta.com/blog/memgpt-and-letta,
  https://medium.com/@piyush.jhamb4u/stateful-ai-agents-a-deep-dive-into-letta-memgpt-memory-models-a2ffc01a7ea1):
  tiered agent memory — core (always visible), recall (searchable
  history), archival (vector-indexed long-term) — persisted to real
  databases. Each agent instance gets its own memory namespace.
  Database-backed persistence is what lets an agent improve *during
  deployment* and survive restarts.
- **State machines as responsibility envelopes**
  (https://github.com/statelyai/agent): each state defines allowed
  tools and transitions; human approval is a state with entry/exit
  conditions, not an interruption. "Prompts are suggestions; code is
  enforcement" (O'Reilly,
  https://www.oreilly.com/radar/from-capabilities-to-responsibilities/).
- **Watchdog escalation tiers**
  (https://rz-ai-learning.com/posts/watchdog-multi-agent-monitoring/):
  TIER 1 log-internally → TIER 2 alert-with-diagnosis → TIER 3
  escalate-with-recommendation. Automated recovery before human
  escalation.
- **Handoff protocols**
  (https://tianpan.co/blog/2026-04-10-escalation-protocol-agent-to-human-handoffs):
  prepare (package state + provenance) → validate (entry checks) →
  approve (recorded) → commit. Handoff quality = state serialization
  quality.
- **Event sourcing / log-as-authority**
  (https://event-driven.io/en/audit_log_event_sourcing/): the
  append-only log is the source of truth; current state is a derived
  cache; divergence is a recoverable error, not silent loss.
  Hash-chained entries give tamper evidence.

## The recurring elements (cross-thread convergence)

| Element | Strongest precedent |
|---|---|
| Exclusive scope | RACI one-Accountable; one controller per resource |
| Matching authority | CO model; responsibility-trap literature |
| Reconcile loop | MAPE-K; level-triggered Kubernetes controllers |
| Mandatory ledger | The deck log; event sourcing |
| Private knowledge base | MAPE-K's K; Letta memory namespaces; DB-per-agent |
| Escalation tiers | ICS; watchdog TIER 1/2/3 |
| Handover ceremony | OOW relief briefing; agent handoff protocols |
| Enforcement | Electronic-institution norms; commitment monitors + sanctions |

## The recurring anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| Responsibility without authority | Blame rolls downhill, control stays up; interventions become ad hoc |
| Shared accountability | Each party assumes the other is watching; the duty evaporates |
| No persistent state | Restart = amnesia; events visible, trends invisible |
| Optional logging | Audit gaps; silent agent indistinguishable from dead one |
| No escalation boundary | Agent exceeds scope unpredictably; no "wake the captain" trigger |
| Shared mutable state | Races, blame ambiguity, coordination overhead |
| Informal handover | State lost between agent generations; no durable transition record |
| Prompt-only obligations | Suggestions, not enforcement; fail quietly at scale |
