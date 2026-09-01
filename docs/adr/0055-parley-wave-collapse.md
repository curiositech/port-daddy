# 0055. Parley - Forced Reconciliation And Swarm Coordination Receipts

## Status

Accepted for Phase 0 - 2026-06-15

Authority update (STORE0, 2026-08-24): the original tuple-backed prototype has
been supplanted. Canonical Parley records, participants, turns, exact seen
receipts, outcomes, automatic admissions, cooldowns, and notification intents
now live in one tenant/harbor-scoped SQLite authority in
`lib/parley-store.ts`. Tuples, if emitted by a future observer, are
non-authoritative projections and can never admit, mutate, settle, or resolve a
Parley.

Numbering note: 0051 is claimed by PR #316 (marketplace protocol), 0053 by
PR #366 (out-of-band enforcement), and 0054 by PR #368 (release cadence). 0055
is the lowest free number at time of writing.

## Context

The operator's June 12 parley ask was direct:

> I want a real parley. I want agents working on similar things to be forced
> to message or subscribe to a chat or SOMETHING. Or maybe when unspider sees
> redundancy or contradiction, we force them to parley to reconcile a single
> outcome? Wave collapse?

The June 15 follow-up raised the broader coordination problem: Port Daddy has
many primitives, but a tool cannot claim serious swarm coordination while
overlap detection, reconciliation, roadmap truth, skill selection, and incentive
design remain foreign to the product.

The shipped substrate is strong enough to build on:

| Primitive | Source | Role in parley |
|---|---|---|
| **Port Daddy sessions** | `lib/sessions.ts` | Durable agent work records, active ownership, file claims, and notes. |
| **Actor inbox and attention** | `lib/agent-inbox.ts`, `lib/attention.ts` | Durable summons delivery. |
| **Tube channels** | `lib/tube.ts` | Shared parley venue. |
| **Performative envelope** | `lib/ipc-types.ts`, `lib/ipc-frame.ts` | Typed `propose`, `agree`, `refuse`, and `inform` turns. |
| **File claims and claim watcher** | `lib/sessions.ts`, `lib/claim-watcher.ts` | The shipped overlap signal for trigger v1. |
| **Tuple space** | `lib/tuples.ts` | Optional Linda-style telemetry projection only; never Parley authority. |
| **Arbiter** | `lib/arbiter.ts` | Making "ship the contested surface" unreachable once freeze is wired. |
| **Coast Guard rent** | `lib/coast-guard/compulsion.ts` | Pricing silence and abandoned obligations. |
| **Durable commitments** | `lib/commitments.ts`, `lib/obligation-monitor.ts` | Recording collapsed outcomes and watching adoption. |
| **roadmap_items** | `lib/roadmap-items.ts` | Durable roadmap truth; markdown is only a projection. |
| **Coordination Guard** | `cli/commands/guard.ts` | Commit-time enforcement for session, claim, note, and roadmap-receipt discipline. |

The gap was compositional: nothing forced convergence when two live agents held
divergent intents over one scarce surface. Claims were advisory. Suggestions
were dismissible. Chat memory was not a durable protocol.

First-use external terms:

- **FIPA ACL** (Foundation for Intelligent Physical Agents, 2002; Bellifemine,
  Caire, and Greenwood, 2007) is a performative vocabulary for agent messages
  such as `propose`, `inform`, `agree`, and `refuse`.
- **Contract Net** (Smith, 1980) is a classic multi-agent task-allocation
  protocol: announce a task, collect bids, award work.
- **Goodhart's law** (Goodhart, 1975) is the warning that a metric becomes
  unreliable once optimized directly.
- **Agent Skills** ([Agent Skills specification, 2026](https://agentskills.io/specification);
  Anthropic, 2025) are portable folders containing `SKILL.md` plus optional
  scripts, references, assets, and templates that an agent loads on demand.
- **Progressive disclosure** ([Agent Skills overview, 2026](https://agentskills.io/))
  is the loading discipline where the agent first sees only skill metadata,
  then the full `SKILL.md`, then referenced resources only when needed.
- **Semantic supply-chain risk** ([Saha, Faghih, and Feizi, 2026](https://arxiv.org/abs/2605.11418))
  is the risk that natural-language skill metadata and instructions manipulate
  discovery, selection, governance, or execution.

## Decision

Port Daddy adopts **parley** (`lib/parley.ts`) as the Phase-0 forced
reconciliation primitive. A parley is an indexed, tenant/harbor-scoped,
transactionally persisted terminating dialogue over a contested surface.

```text
trigger -> SUMMONED -> CONVENED -> COLLAPSED
              |            |
              |            +-> ESCALATED
              +--------------> VOIDED
```

The rule is:

**Divergence is cheap. Publication requires collapse.**

Read-only councils, skeptical reviewers, and exploratory labs may disagree. But
once live intents touch the same scarce surface, the system must leave a parley
record or a roadmap receipt instead of relying on transcript memory.

### Phase-0 Implementation

Phase 0 intentionally ships a small, honest core:

- `lib/swarm-coordination.ts` provides pure `evaluateSwarmFit()` and
  `tallyCouncilVotes()` reducers so swarm admission can be tested without the
  daemon.
- `lib/parley-store.ts` is the sole lifecycle authority: indexed SQLite tables
  hold canonical records, participants, turns, exact seen receipts, outcomes,
  automatic reservations/admissions, cooldowns, terminal evaluation receipts,
  and a durable claim-before-hail outbox. `lib/parley.ts` is its facade. No
  tuple event can authorize or mutate this state.
- A transactional quota ledger bounds retained records, signals, turns, and
  outbox rows per tenant and harbor. Ordinary admissions fail before any
  partial write. Terminal state still commits when the retained outbox is
  exactly full: STORE0 inserts or updates one bounded notification-overflow
  receipt on the Parley instead of attempting an over-quota publication row.
- `routes/parley.ts` exposes `POST /parley/call`,
  `POST /parley/respond`, `POST /parley/resolve`, `GET /parley`, and
  `GET /parley/:id`. The terminal route is registered for contract continuity
  but the production facade rejects every resolve until CAP0 authorizes and
  redeems it. Actor-bearing call, response, and seen-receipt inputs are identity
  integration seams, never self-asserted authority; U0 must bind or retire every
  credentialless mutation before those routes become production-capable.
- `cli/commands/parley.ts` exposes `pd parley fit`, `call`, `respond`,
  `resolve`, `list`, and `show`.
- `cli/commands/roadmap.ts` adds `pd roadmap upsert` and `pd roadmap touch`,
  because a requirement that cannot be satisfied from the CLI is theater.
- `routes/roadmap.ts` accepts structured roadmap receipt notes so the daemon,
  not a markdown file, can be the source of truth.
- `cli/commands/guard.ts` treats coordination architecture changes as
  roadmap-bound: a commit touching parley, roadmap, ADR, research, skill, or
  coordination-manifest surfaces requires a recent `roadmap_items` receipt from
  the active agent.

### Lifecycle

1. **Trigger.** Pluggable sources, ordered by what can ship first:
   - T0 operator: `pd parley call --surface <path|symbol> --with <session...> --reason <text>`.
   - T1 claim overlap: `lib/claim-watcher.ts` observes two active sessions
     claiming intersecting file regions, then auto-summons with debounce,
     dedupe by `(surface, party-set)`, and cooldown.
   - T2 detectors: contradiction and topical-match detectors emit the same
     trigger event with evidence attached.

2. **Summons.** The daemon creates the parley row, a dedicated channel
   `parley:<id>`, and an inbox summons for each party. `pd attention` surfaces
   it. A summons is not a suggestion; from that moment the party owes a
   response.

3. **Freeze.** While a parley on surface `S` is open, the future Arbiter and
   guard integration hold this predicate: no party may publish work touching
   `S`. Phase 0 records the protocol object and roadmap receipt. Phase 1 wires
   the commit-time freeze.

4. **Dialogue.** Turns carry FIPA-style performatives. Each party proposes an
   intended outcome, can critique or revise during a bounded round budget, and
   must end in `agree` or `refuse`.

5. **Collapse.** Unanimous `agree` among live parties writes a durable
   commitment: winning intent, superseded intents, party obligations, and
   deadline. The future obligation monitor watches adoption.

6. **Non-happy paths.** Silence past TTL becomes rent arrears, round exhaustion
   or refusal escalates with transcript, and dead sessions void into salvage.
   Every parley terminates in one of `COLLAPSED`, `ESCALATED`, or `VOIDED`.

### Why "Forced" Is Not Theater

The enforcement stack has three teeth:

1. Attention: the summons appears in the session's attention surface.
2. Freeze: the contested surface cannot be published while the parley is open.
   In-band guard checks are advisory until the same predicate is evaluated by
   the out-of-band push broker from ADR-0053.
3. Rent: silence is priced through Coast Guard consequences, so ghosting the
   parley costs the sandbox even if an agent tries to bypass an in-process
   check.

This is the mechanism-design posture Port Daddy should use elsewhere: make the
cooperative path cheaper than the dark lane.

## Roadmap Discipline

The roadmap is durable state, not a wish list. A coordination change that adds a
new protocol, guard, agent handoff behavior, skill surface, or release boundary
must update `roadmap_items`. `docs/ROADMAP.md` may render or explain that state,
but it is not the authoritative queue.

The live Phase-0 roadmap row is `swarm-coordination-parley`. Future phases use
these slugs:

| Phase | Roadmap slug | Status | Description |
|---|---|---|---|
| 0 | `swarm-coordination-parley` | now | Fit gate, council tally, indexed transactional Parley authority, CLI/API, manifest/completions, and guard-enforced roadmap receipts. |
| 1 | `parley-surface-freeze` | backlog | Guard refuses party commits on a contested surface while an open parley exists. |
| 2 | `parley-rent-integration` | backlog | Silence past parley TTL becomes Coast Guard rent arrears. |
| 3 | `parley-claim-overlap-trigger` | backlog | Claim overlap auto-summons a parley with debounce and cooldown. |
| 4 | `parley-collapse-commitments` | backlog | A collapsed parley writes durable per-party commitments and unblocks only after commitment creation. |
| 5 | `parley-detector-triggers` | backlog | Contradiction and topical detectors emit parley triggers with their finding attached. |

## Jury-rig Skill Graft

Each phase carries a Jury-rig skill graft. Before opening implementation work for
that phase, the agent must load the named skill files or call
`pd jury-rig query` for the phase task, then apply the phase gates below.

| Phase | Primary graft | Support graft | Required output |
|---|---|---|---|
| 0 | `multi-agent-coordination` | `build-verification-expert` | Fit/tally/parley tests, route/CLI tests, typecheck, parity/build checks, and a `roadmap_items` receipt. |
| 1 | `dag-scope-enforcer` | `multi-agent-coordination` | Guard tests for exact path, absolute path, symlink, symbol/region, non-party, collapsed parley, and stale parley cases. |
| 2 | `normative-bdi-agents` | `dag-scope-enforcer` | Rent/arrears tests showing TTL expiry creates a measurable breach and refusal/escalation terminates the debt. |
| 3 | `multi-agent-coordination` | `dag-parallel-executor` | Claim-overlap trigger tests covering no-overlap, exact overlap, region overlap, duplicate claims, cooldown, and abandoned-session cleanup. |
| 4 | `normative-bdi-agents` | `dag-feedback-synthesizer` | Commitment rows per party, obligation-monitor coverage, adoption breach events, and transcript-to-commitment traceability. |
| 5 | `agentic-skill-discovery` | `dag-feedback-synthesizer` | Detector evidence schema, false-positive evaluation, confidence thresholds, and operator-visible feedback for rejected triggers. |

## Incentive And Mechanism Graft

The game-theory and mechanism-design skills add constraints that parley cannot
skip:

- `game-theoretic-agent-incentives`: advisory claims are cheap talk in a
  one-shot game. Truthful claims need observable history, persistent identity,
  correlated daemon recommendations, or credible sanctions.
- `mechanism-design-for-agent-labor`: reputation is a discount on collateral,
  not a substitute for it. For high-risk coordination, bonds, rent, or escrow
  must be priced by scope, duration, criticality, and agent history.
- `nisan-et-al-2007-algorithmic-game-theory` and
  `shoham-leyton-brown-2009-mas-foundations`: existence of an equilibrium is
  not enough; Port Daddy needs computable mechanisms and explicit impossibility
  trade-offs.
- `ostrom-commons-governance`: sanctions must be graduated, conflict
  resolution must be cheap, and local project rules should nest inside global
  Port Daddy rules.

## Skill Evolution Check

The June 15, 2026 ecosystem check changes the graft design:

- Anthropic's engineering writeup defines skills as folders of instructions,
  scripts, and resources, with progressive disclosure from metadata to
  `SKILL.md` to referenced files, and notes that code can be bundled for
  deterministic operations ([Anthropic, 2025](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).
- The open Agent Skills spec standardizes `SKILL.md`, optional `scripts/`,
  `references/`, and `assets/`, recommends keeping core instructions small, and
  says clients may expose project, user, organization, and built-in scopes
  ([Agent Skills spec](https://agentskills.io/specification);
  [client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)).
- **Skilldex** ([Saha and Hemanth, 2026](https://arxiv.org/abs/2604.16911))
  adds package-manager semantics: hierarchical scopes, conformance scoring, a
  metadata registry, and skillsets that bundle related skills.
- **SkillOps** ([Pu, Song, and Zhao, 2026](https://arxiv.org/abs/2605.13716))
  treats skill libraries as maintained ecosystems with typed skill contracts and
  a hierarchical skill graph.
- **SkCC** ([Ouyang et al., 2026](https://arxiv.org/abs/2605.03353)) compiles
  skills through a typed intermediate representation so the same skill
  semantics can target different agent frameworks and enforce security checks.
- Skill-security research shows `SKILL.md` is operational text, not passive
  documentation: metadata-only attacks can manipulate discovery, selection, and
  governance ([Saha, Faghih, and Feizi, 2026](https://arxiv.org/abs/2605.11418)).
- Skill-comprehension research argues specs should expose operational basis,
  output contract, boundary disclosure, and examples ([Wen, 2026](https://arxiv.org/abs/2605.19362)).

Therefore Port Daddy should assume skills are a software supply chain:
discoverable, scoped, versioned, bundled, validated, compiled, and attacked.

`pd jury-rig query` keeps its existing job: attach existing Jury-rig skills to
a task, node, or implementation phase.

Port Daddy names a new proposed tool, **`pd seamanship sync`**, for the
different job: discover global skills, user skills, organization/shared
bundles, and repo-local skills, then produce provenance-preserving Jury-rig skill
cards and a curated activation plan.

The target pipeline is:

```text
prompt
  -> meta-skill/router
  -> candidate skills
  -> selected skills
  -> selected references/scripts/templates/assets
  -> bounded excerpts or full resources
  -> execution with unloaded-resource ledger
```

`pd seamanship sync` should enrich inducted skills with invocation criteria,
NOT-for boundaries, IO contracts, resource indexes, provenance, trust tier,
compatibility metadata, eval prompts, security notes, compact presentation
digests, and per-reference excerpt budgets.

The core data model is:

- **RawSkillArtifact**: immutable source evidence, digest, license, owner,
  path/URI, and trust tier.
- **SkillCard**: normalized activation rules, IO contracts, resource indexes,
  provenance, evals, security notes, and parent/child meta-skill edges.
- **ActivationPlan**: the current task's selected skills, selected resources,
  excerpt budgets, missing contracts, unloaded resources, and near-miss
  exclusions.

## Alternatives Considered

- Advisory suggestions only. Rejected as incomplete: useful for nudging, but
  not enough when two agents can land incompatible futures.
- First-claim-wins exclusion. Rejected because it kills useful parallel
  thinking and makes the first claimant accidentally authoritative.
- Majority vote. Rejected for contested implementation surfaces. A losing writer
  still has to adopt the outcome; unresolved refusal must escalate instead of
  being outvoted.

## Consequences

- ADR-0031/0032/0039 get the consumer they lacked: detection now has a
  defined, enforced downstream instead of a dismissible toast.
- ADR-0047 gets its first end-to-end *protocol pattern* in production: a
  bounded, typed dialogue with real termination.
- Port Daddy coordination is no longer only notes plus claims. It has a first
  protocol object for overlap reconciliation.
- The first implementation does not yet freeze commits on contested surfaces.
  That is a later guard integration once open-parley surface matching is wired.
- Roadmap discipline is enforceable through the daemon and guard. A stale
  installed daemon that cannot persist receipts is now visible as a product
  fault, not an excuse to skip the roadmap.
- Meta-skills are allowed as category routers, not as junk drawers. A meta-skill
  must produce bounded candidate sets, confidence, redirects, missing-capability
  gaps, and the next resources to load.
- A Jury-rig graft used in another repo may call `pd seamanship sync` before
  selection, but induction is not grafting. Induction imports and normalizes
  candidate skill artifacts; grafting selects and applies already-normalized
  skills.
- The freeze adds a new way for a commit to be refused. Scoping it to
  (surface × parties × open parley) keeps the blast radius minimal, but the
  guard copy must be excellent — a confused agent in a frozen lane is the
  main UX risk.
- Parley spam is the main mechanism risk; debounce/dedup/cooldown in phase 3
  are load-bearing, not polish.
- N-party parleys (3+) are supported by the same unanimity rule; if live
  experience shows convergence stalls at N≥3, escalation budgets can tighten
  with party count rather than weakening unanimity.

## Addendum (2026-06-16): Identity, Continuity & the Dormant-Party Problem

This addendum applies the **identity → continuity → reputation** design
discipline to parley after a substrate audit. The body above assumed three
properties the substrate does **not** yet provide: that parties stay live to
exchange turns, that a party can be *driven* to take a turn, and that a dead
party can be replaced. None hold today. This section records the honest
verdict so `lib/parley.ts` is built on what exists, not on what the prose
implied.

The discipline's through-line: *memory + checkpoint → continuity → a person
(not a spawn) → outcomes closed against an oracle → reputation → a market*.
A parley is a conversation **between persons over time**, so every link in
that chain is load-bearing for it. Graded against current `origin/main`:

| Link | Substrate (verified) | Verdict for parley |
|---|---|---|
| **Non-forgeable identity** (ADR-0040) | Proposed, unbuilt. Identity is a **self-asserted string**; no daemon-minted id bound to a credential. | **Broken.** A defector respawns clean (*whitewashing*, Friedman & Resnick 2001; *Sybil-reset*, Douceur 2002). Rent/bond penalties bite **per-process only** — no durable punishment across respawns. |
| **Continuity-of-record** (episodic memory `lib/episodic-memory.ts`, notes, the dormant-not-dead model `lib/session-liveness.ts`) | Shipped and genuinely good — a session is a *durable work context*; no live process means **dormant**, not dead. | **Holds.** The parley **transcript** (turns as immutable notes) survives every process death. |
| **Continuity-of-state** (checkpoint) | Absent. Resurrection (`lib/resurrection.ts`) forwards **notes to a successor**, not execution/belief state. | **Broken — and must be labelled.** A party that "resumes" a parley is a **successor reconstructing intent from the transcript, not the same person**. This is psychological *connectedness*, not *continuity* (Parfit 1984). Do **not** sell it as checkpointing. |
| **Outcome closed against an oracle** (ADR-0041, `lib/commitments.ts`) | Shipped. `close()` refuses without a non-empty `closed_by_oracle_ref` (a merged SHA / released claim / passing test). | **Holds — the one strong link.** The parley *collapse* closes against an oracle, not against "we agreed." |
| **Reputation** (estimator) | Absent. Bonds escrow (`lib/bonds.ts`) exists but keys on the **forgeable** id. | **Cannot be trustworthy yet.** No reputation without continuity; none without non-forgeable identity. Parley cooperation/defection **must not** feed a durable reputation until ADR-0040. |

### What this means, decision by decision

- **Liveness (the dormant-party problem).** Parley state is durable; parley
  *progress* is not. Tube is **poll-based, no server-push, no blocking**
  (`lib/tube.ts`), and agents are **fire-and-forget** with no mid-run prompt
  injection — they only see messages when they poll `pd attention` (wired at
  SessionStart, not mid-task). Therefore parley turns are **deadline-driven,
  asynchronous, and dormant-safe**: each party has a turn-TTL; a missed
  deadline advances the protocol (escalate/void) rather than blocking on a
  live reply. A real-time request/response negotiation is **not** what to
  build — that substrate does not exist.

- **Replacement.** There is **no auto-spawn** anywhere (`lib/resurrection.ts`
  only watches/queues/emits; nothing respawns). A death mid-parley therefore
  routes to the **operator attention queue** with the full transcript — a
  human collapses the wave. An auto-respawn *listener* (a Tender that claims a
  dormant parley party and spawns a successor) is genuinely new work and is
  **explicitly deferred**, not assumed.

- **Defection.** "Won't some defect?" — yes, and without ADR-0040 the rent
  tooth only prices silence *within one process lifetime*. The stopgap is the
  discipline's **newcomer floor**: a fresh self-asserted id may *work* fully
  but its economic *ceiling* (bond size it can stake, parleys it can bind
  others to) is capped until a clean-exit history accrues. This prices churn
  without waiting on ADR-0040, and is honest about being a stopgap.

- **Goodhart on the collapse.** An agent can `agree` then betray the agreed
  outcome. Defence is already shipped: the collapse is an **oracle-closed
  commitment** (ADR-0041), and a **sampled adversarial auditor** re-opens a
  random + risk-weighted fraction of collapsed parleys and re-checks that the
  superseded intents actually stood down (claims released / branches demoted).
  An audit-failed fake must cost **more** than honest non-agreement.

### Lifecycle visibility (a first-class requirement, buildable now)

Per the operator's explicit ask — *everything reading agent lifecycle/status
must show a parley is happening*. This is cleanly buildable on shipped
surfaces: `session.phase` is an extensible enum read by `pd sessions`,
`pd whoami`, `pd sitrep`. Parley adds a `parley` phase (carrying the parley id
and counterpart session ids) plus `activity.ts` `PARLEY_*` event types, so the
state propagates to those surfaces, the activity firehose, and the cockpit
lane. A party in an open parley reads as such *everywhere*, including to the
operator deciding whether to intervene. This lands as part of phase 0, not
later.

### Revised build order (honest about the gated links)

- **Phase 0 (buildable now, leans only on shipped links):** indexed
  `lib/parley-store.ts` authority surfaced through `lib/parley.ts`, with
  `session.phase` as a projection and durable store turns as the transcript;
  **deadline-driven, dormant-safe** closure; manual trigger; lifecycle
  visibility above; **every failure mode routes to operator escalation** with
  the transcript (the safety net that makes parley useful before auto-spawn or
  ADR-0040 exist).
- **Phase 0.5 (prerequisite spike):** a lightweight **mid-run turn-poll** in
  the agent harness (extend the SessionStart attention hook to poll
  `parley:<id>` while a parley is open). Without this, no agent takes a turn —
  this is the real unknown, prove it first.
- **Phase 4 (already in matrix):** collapse → ADR-0041 commitment — **promote
  in priority**, since oracle-closure is the strong link and should anchor the
  design early.
- **Gated on ADR-0040 (defer explicitly, do not fake):** persistent
  cross-respawn accountability, bond sizing that survives whitewashing, and
  any reputation effect of parley conduct. Until 0040, parley's teeth are
  rent + the newcomer floor + operator escalation — real, but per-lifetime.
- **Gated on a real checkpoint (defer explicitly):** same-person resume of a
  parley turn. Until then, a resumed party is a labelled **successor**.

### Honest-ceiling caveat

Parley, fully built, proves **delivery of a reconciled outcome against an
oracle on a clock the parties did not set**. It does **not** prove the
reconciliation was *wise*, nor that the surviving intent was the *better* one —
only that the contested surface did not land in two incompatible states. And
until ADR-0040, it cannot prove the *same person* is accountable across the
conversation's life. Those are the boundaries; the design must not overclaim
past them.
