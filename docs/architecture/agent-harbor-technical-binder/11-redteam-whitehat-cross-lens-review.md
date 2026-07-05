# 11 Redteam Whitehat Cross Lens Review

Status: binder addendum.

Purpose:
  Tear the Agent Harbor plan apart from the requested security, economics,
  planning, AI engineering, transaction, context, partitioning, and error
  boundary perspectives. This chapter is deliberately harsher than
  [08 Adversarial Review](./08-adversarial-review.md). The earlier review asks
  whether the plan is coherent. This one asks whether it survives hostile users,
  broken adapters, budget pressure, failed launches, bad memory, public harbor
  incentives, and real UI failure.

## Applied lenses

Cryptoeconomic protocol security:
  Economic incentives must be quantified. Bonds, reputation, receipts, and
  sanctions are not defenses unless their cost of attack exceeds expected
  damage and their oracles cannot be cheaply manipulated.

Security auditing:
  Hooks, MCP servers, scripts, transcript stores, provider keys, and cloud
  sync are all security boundaries. Critical and high findings should block
  promotion to hosted or team harbors.

Resource-bounded planning:
  The project must not keep expanding the plan forever. Each milestone needs a
  commitment level, override threshold, assumption monitor, and refinement
  trigger.

Hypertree planning:
  The work is not a linear to-do list. It is a hypergraph of constraints:
  agent truth, governance, UI, memory, security, cloud/account, and market
  dynamics can advance independently only when their interfaces are explicit.

AI engineering:
  Transcript search, memory retrieval, tool selection, model routing, and
  skill grafting require evals, latency gates, drift monitoring, and graceful
  fallback. "The agent can search memory" is not an engineering claim until it
  has retrieval metrics.

Distributed transactions:
  Launching, steering, billing, granting tools, persisting transcripts, opening
  PRs, and issuing receipts is a saga. Every forward step needs durable state,
  idempotency, a timeout, and a compensating action.

Context economics:
  Recording all transcripts by default is correct for learning and control.
  Injecting all transcript material is not. Context is a scarce resource, so
  every digest needs a reader, a budget, and a zoom link to durable evidence.

Agent context partitioning:
  Spawning agents should be a measured partition decision, not a vibe. The
  plan needs explicit stay-cost versus spawn-cost records, causal closure, and
  handoff packets.

Error boundary strategy:
  The operator app cannot show blank panes, stale "no frames yet" states, or
  crash cascades. Each pane needs a recoverable fallback, retries, and honest
  degradation.

## Verdict

The binder is pointed at the right product, but the current target architecture
is still too optimistic unless these changes become hard gates:

- every Agent Node run is an idempotent saga, not just a process record;
- every compliance claim is daemon-witnessed and negatively probed;
- every transcript is saved locally by default, with redaction before
  persistence and visible retention controls;
- every memory or skill graft is budgeted and source-linked;
- every public or team harbor feature waits behind quantified abuse economics;
- every native-app pane has a useful failure state and a click path to repair;
- every milestone states what can override the plan and what evidence commits
  the team to the next step.

The main redteam finding is not "this is impossible." It is that Port Daddy can
easily build a beautiful shell around unverified primitives. The whitehat
answer is to promote proofs, probes, budgets, receipts, and compensations to
first-class product objects.

## Round 1 - Redteam findings

### R1. Bonds and reputation are named but not priced

Lens:
  Cryptoeconomic protocol security.

Attack:
  A public or team harbor agent accepts work, claims files, consumes review
  time, emits low-quality output, and abandons the task. If the only penalty is
  vague reputation loss, a cheap or disposable identity can repeat the attack.

Why the binder is insufficient:
  [05 Cooperative Coding And Governance](./05-cooperative-coding-and-governance.md)
  discusses sanctions and reputation, but it does not quantify maximum damage,
  bond size, cleanup cost, dispute cost, or newcomer limits.

Whitehat defense:
  Do not rely on bonds first. Limit authority first. A new or low-reputation
  agent should get small budgets, narrow file grants, short leases, no public
  publishing rights, and no team-wide secrets. If economic bonding is added,
  define `bond >= max_cleanup_cost + operator_review_cost + dispute_cost` for
  each work class.

Required binder change:
  Milestone 8 and 10 need an "economic attack table" before sanctions or public
  harbors ship.

### R2. Oracles can be manipulated

Lens:
  Cryptoeconomic protocol security.

Attack:
  The system pays or promotes agents based on a work receipt, PR state, review
  comment, test result, or skill-validation verdict that the agent influenced.
  A colluding reviewer or compromised adapter marks bad work as complete.

Why the binder is insufficient:
  Work Receipts are canonical, but the binder does not yet specify which
  events are trusted, who can attest them, and how disputes reverse bad
  attestations.

Whitehat defense:
  Use daemon-witnessed events for local truth, GitHub API evidence for PR truth,
  independent reviewer verdicts for high-risk work, and quorum or appeal only
  for expensive public-harbor decisions. Low-value single-operator decisions
  can be accepted risk, but the risk must be named.

Required binder change:
  Add an oracle registry to the Work Receipt design: source, trust tier,
  manipulation risk, appeal path, and accepted-risk owner.

### R3. Agents can grief with claims, budgets, and stale liveness

Lens:
  Cryptoeconomic protocol security and resource-bounded planning.

Attack:
  A malicious or broken body repeatedly claims hot files, leaves stale sessions
  alive, keeps parleys open, or burns Longshoreman attention. No data is stolen,
  but the harbor becomes unusable.

Why the binder is insufficient:
  The plan marks stale agents and discusses claim governance, but it does not
  define progress checkpoints, rent, reclaim rules, or rate limits as measurable
  controls.

Whitehat defense:
  Every claim lease gets a heartbeat, progress evidence, and expiration. The
  progress oracle should use transcript events, file diffs, test runs, PR
  updates, and operator actions, not just adapter self-report. Stale claims move
  to soft warning, then reclaim, then reputation penalty.

Required binder change:
  The Agent Node state machine needs `claim_lease`, `progress_checkpoint`, and
  `reclaimable_at` fields. `pd-console` should show stale claims as a repair
  card, not as active work.

### R4. Public harbors are Sybil-prone

Lens:
  Cryptoeconomic protocol security.

Attack:
  A user creates many identities to farm reputation, evade sanctions, flood
  public skill reviews, or manipulate marketplace rankings.

Why the binder is insufficient:
  Public harbors are correctly pushed to Milestone 10, but the design still
  speaks about marketplace-like features before defining identity cost,
  newcomer privilege, proof-of-work, proof-of-payment, invitation, or vouching.

Whitehat defense:
  Public harbor launch requires a Sybil table:

- identity creation cost;
- initial capability limits;
- reputation warmup curve;
- team invitation and vouching rules;
- rate limits per payment instrument, device, and account;
- moderation and appeal.

Required binder change:
  Milestone 10 cannot include public skill sharing until this table exists and
  passes abuse review.

### R5. Claims and roadmaps leak competitive intent

Lens:
  Cryptoeconomic protocol security.

Attack:
  In a shared or public harbor, visible claims, task manifests, skill drafts, or
  roadmap entries reveal what the operator is building. Another party can
  front-run the work, poach a task, or exploit known weak spots.

Why the binder is insufficient:
  The binder assumes shared legibility is good. That is true inside a trusted
  local harbor, but not in public or cross-company contexts.

Whitehat defense:
  Add sensitivity labels for tasks, claims, transcripts, and blackboard cards.
  Competitive work uses private channels, delayed publication, or commit-reveal
  task descriptions. The default public-harbor view should reveal less than the
  private operator view.

Required binder change:
  [05 Cooperative Coding And Governance](./05-cooperative-coding-and-governance.md)
  needs "legibility scope" as a field, not just legibility as a value.

### R6. Transcript-by-default creates secret-retention risk

Lens:
  Security auditing.

Attack:
  A provider key, SSH URL, token, customer name, local path, or private bug
  detail appears in a tool output and is saved forever. The user later enables
  cloud sync or shares a harbor, and the sensitive payload travels.

Why the binder is insufficient:
  [06 Security Privacy Billing And Accounts](./06-security-privacy-billing-and-accounts.md)
  correctly says transcripts are saved locally by default and redacted before
  persistence, but the plan does not yet make redaction a tested launch gate.

Whitehat defense:
  Keep local transcript capture on by default. Add a redaction pipeline before
  persistence with entropy scanning, known provider-key patterns, `.env` path
  detection, SSH/private-key markers, OAuth token patterns, and user-added
  regexes. Store the original only if the user explicitly enables encrypted
  raw retention for that harbor.

Required binder change:
  Milestone 1 must include a transcript-redaction fixture and a "raw secret
  cannot persist unredacted" test. Milestone 10 cloud sync must fail closed if
  redaction state is unknown.

### R7. MCP and scripts can bypass policy even when hooks are installed

Lens:
  Security auditing.

Attack:
  A custom MCP server or script runs `git reset --hard`, reads secrets, edits
  outside the worktree, or posts externally without going through the daemon
  gate. The agent appears Port Daddy compliant because its chat hook works.

Why the binder is insufficient:
  The plan requires manifests and hash drift detection, but the first milestones
  do not yet make path, environment, and MCP registry authority crisp.

Whitehat defense:
  Official Agent Nodes launch through a gateway that controls PATH, environment,
  MCP config, working directory, tool manifests, and capability leases. A hook
  alone can only reach observed or weak compliance.

Required binder change:
  Milestone 3.5 should require MCP config hash checks, environment diff checks,
  and a side-effect probe for blocked commands.

### R8. Memory retrieval lacks engineering metrics

Lens:
  AI engineering.

Attack:
  Transcript search returns plausible but wrong episodes. Longshoremen compact
  from bad retrieval. A successor agent resumes with false context and edits the
  wrong surface.

Why the binder is insufficient:
  The memory chapter is conceptually strong, but it lacks retrieval targets,
  latency gates, citation precision, and drift monitoring.

Whitehat defense:
  Build an eval corpus from known transcripts and questions:

- retrieval@5 for known episodes;
- citation precision for cited answers;
- P95 latency for search;
- context utilization for injected memories;
- hallucination rate in answer summaries;
- embedding drift alerts after model changes.

Required binder change:
  Milestone 6 needs explicit memory eval gates before successor resume is
  treated as reliable.

### R9. Tool hallucination loops can make compliant agents dangerous

Lens:
  AI engineering and security auditing.

Attack:
  A model repeatedly calls a missing tool, fabricates success, retries a
  destructive action under a different spelling, or loops through adapters that
  disagree about schema.

Why the binder is insufficient:
  The tool-gate plan blocks known destructive commands but does not yet define
  max tool iterations, schema rejection, or repeated-failure escalation.

Whitehat defense:
  Tool calls need strict JSON schema validation, canonical action classes,
  normalized risk classification, max iteration budgets, and error summaries
  that steer the agent away from repetition. Repeated unknown-tool or denied
  destructive-tool attempts should open an operator card.

Required binder change:
  Milestone 5 should add tool-loop fixtures and require a transcript event for
  every schema rejection or normalized denial.

### R10. "Save every transcript" can become "inject every transcript"

Lens:
  Context economics.

Attack:
  The system collects excellent history, then floods every agent with a giant
  recap. The agent loses the current task, pays too much, and starts citing
  stale work as current truth.

Why the binder is insufficient:
  The plan distinguishes archival memory from injected context, but it does not
  require a token ledger or per-reader digest at the milestone gates.

Whitehat defense:
  Keep all local transcripts. Inject only through a `ContextEnvelope` with
  reader, purpose, budget, source links, expiry, and omitted-risk list. The
  daemon should meter token spend per agent-task and show what memories were
  injected, not merely what exists.

Required binder change:
  Milestone 6 must require a token ledger and per-reader digest budget.

### R11. Spawning agents is still too informal

Lens:
  Agent context partitioning.

Attack:
  The operator or Longshoreman spawns many agents because the work feels broad.
  Agents duplicate context, miss causal prerequisites, and produce conflicting
  partial plans.

Why the binder is insufficient:
  The binder includes the right split inequality, but it does not yet make the
  partition decision itself a durable event.

Whitehat defense:
  Every significant split should record:

- stay cost estimate;
- split cost estimate;
- communication cost estimate;
- selected K or reason K was fixed;
- causal dependencies copied or summarized;
- handoff packet id;
- expected reconciliation point.

Required binder change:
  Add `partition_decision` and `handoff_packet` events to the schema in
  [09 Data Model And API](./09-data-model-and-api.md).

### R12. The roadmap is still too sequential

Lens:
  Hypertree planning.

Attack:
  The team treats Milestone 1 through 10 as a single dependency chain. UI work
  waits for memory work, memory waits for cloud work, and governance waits for
  a perfect model.

Why the binder is insufficient:
  The work DAG is useful but too linear for a project with independent
  constraint domains.

Whitehat defense:
  Convert the roadmap into a hypertree with independent hyperedges:

- agent truth and transcript capture;
- minimal governance and tool gates;
- operator app and editor UX;
- context, memory, and skill grafting;
- security, account, and cloud sync;
- cooperative governance and public harbor economics.

Required binder change:
  Milestone planning should track "structure phase" and "content phase" for
  each hyperedge. Integration milestones should join explicit interfaces, not
  vague readiness.

### R13. The plan can over-plan itself to death

Lens:
  Resource-bounded planning.

Attack:
  Each new concern becomes another binder chapter. The team keeps designing
  public harbor governance, mobile, cryptoeconomics, and GPUI polish before a
  single compliant Agent Node streams transcript into the app.

Why the binder is insufficient:
  The binder has rollout order, but it lacks commitment thresholds and
  refinement triggers.

Whitehat defense:
  Each milestone should state:

- commitment level: exploratory, provisional, committed, or locked;
- deliberation budget;
- override threshold;
- assumption monitor;
- evidence required to advance;
- evidence that forces rollback or redesign.

Required binder change:
  Add a Milestone Control Ledger and keep the target override rate around
  10-20 percent. Zero overrides means rigidity; constant overrides means no
  planning.

### R14. Agent launch is a distributed saga, not a command

Lens:
  Distributed transaction management.

Attack:
  Port Daddy reserves an Agent Node, launches a body, grants provider secrets,
  starts a stream, opens a worktree, bills a budget, and writes transcripts.
  One step fails or times out. The UI shows a ghost agent, the body keeps
  running, or the user is charged for a session they cannot see.

Why the binder is insufficient:
  The data model has many entities, but the launch/attach/control lifecycle is
  not yet specified as a durable saga with compensations.

Whitehat defense:
  Define the Agent Run Saga:

1. reserve identity;
2. reserve worktree or remote sandbox;
3. reserve budget;
4. create transcript stream;
5. launch or attach body;
6. perform compliance probe;
7. grant capability leases;
8. enter running state;
9. finalize receipt;
10. release leases and claims.

Each step needs idempotency key, timeout, compensation, terminal states, and
dead-letter handling.

Required binder change:
  Add an Agent Run Saga ADR before implementing cross-provider launch.

### R15. Interrupt and revoke can race remote execution

Lens:
  Distributed transaction management and security auditing.

Attack:
  The operator clicks Interrupt. The local UI marks the agent interrupted, but
  the remote worker already received another tool grant or keeps executing
  under stale leases.

Why the binder is insufficient:
  The binder requires pause/kill controls but not revocation acknowledgement,
  lease expiry, or terminal-state reconciliation.

Whitehat defense:
  Commands are idempotent events with ack status. Capability leases are short
  and renewable. Remote bodies must prove they observed revocation or be marked
  suspect. The UI shows "interrupt requested," "interrupt acknowledged," and
  "leases expired" separately.

Required binder change:
  Control commands need a saga state machine and tests for delayed ack, lost
  ack, duplicate command, and remote timeout.

### R16. The app can fail in exactly the way the user hates

Lens:
  Error boundary strategy.

Attack:
  `pd-console` shows blank panes, stale "waiting for frames" text, raw IDs,
  or a frozen list when a route fails. The user cannot tell whether the agent
  is dead, non-compliant, still streaming, or merely hidden behind a UI error.

Why the binder is insufficient:
  The operator-control chapter has the right target UI, but not resilience
  gates for pane failures.

Whitehat defense:
  Treat every pane as an error boundary:

- roster pane fallback: cached recent sessions plus reconnect;
- transcript pane fallback: historical transcript, live-stream error, retry;
- files pane fallback: absolute path reconstruction error plus open-in-Finder;
- controls pane fallback: disabled controls with compliance reason;
- remediation pane fallback: doctor command and support bundle export.

Required binder change:
  Milestone 4 needs GPUI resilience tests that inject route failures, stream
  disconnects, missing transcripts, and malformed events.

### R17. Security gates are not wired into the rollout

Lens:
  Security auditing.

Attack:
  The daemon, hooks, MCP gateway, website, and app ship with vulnerable
  dependencies, secret patterns in logs, unreviewed permissions, or weak
  defaults because each milestone focuses on product behavior.

Why the binder is insufficient:
  Security is a chapter, but not enough of it is expressed as CI and release
  gates.

Whitehat defense:
  Add milestone-specific scans:

- dependency audit for Node and Rust;
- secret scan for source, docs, artifacts, transcripts, and fixtures;
- SAST for injection, path traversal, command execution, SSRF, and auth;
- permission manifest diff for MCP/scripts/hooks;
- manual threat review for cloud/account/public harbor changes.

Required binder change:
  Milestones 1, 3.5, 5, and 10 need security gates before they can be called
  complete.

### R18. The public harbor externalizes context costs

Lens:
  Context economics and cryptoeconomic protocol security.

Attack:
  In a team or public harbor, one agent floods the blackboard, transcript
  digest, or parley channel. Every other agent now pays tokens to process its
  noise.

Why the binder is insufficient:
  The binder treats shared context as coordination value, but shared context
  also imposes external costs on readers.

Whitehat defense:
  Charge or limit context publication by audience size and downstream budget.
  A message to one agent is cheap; a message injected into every active
  Voyager is expensive. Shared digests need size limits, relevance filters,
  expiry, and feedback.

Required binder change:
  The blackboard and parley protocol need audience, expiry, budget impact, and
  subscriber filters.

## Round 2 - Adversarial probes to add

These probes turn the findings into tests.

| Probe | Lens | Passing behavior |
| --- | --- | --- |
| Forged compliance adapter | Security | Adapter claims C4, but daemon side-effect probe downgrades it when a denied command secretly runs. |
| Secret in transcript fixture | Security | Token is redacted before persistence; event remains hash-linked with redaction marker. |
| Hook removed mid-run | Security | Agent downgrades, controls disable, remediation card appears, and transcript records the drift. |
| MCP config tamper | Security | Hash drift is detected before tool grant; affected tools become unavailable. |
| Remote interrupt lost ack | Transactions | UI shows requested state, lease expiry proceeds, run reaches terminal suspect or interrupted state. |
| Duplicate launch request | Transactions | Same idempotency key returns the existing Agent Node; no duplicate body or budget reservation. |
| Tool hallucination loop | AI engineering | Unknown tool retries stop at the configured cap and create an operator-visible event. |
| Bad memory retrieval | AI engineering | Eval detects wrong citation or missing source; answer is marked low-confidence. |
| Context flood | Context economics | Shared digest is clipped by reader budget and offers zoom links instead of full injection. |
| Bad handoff packet | Context partitioning | Missing causal dependency fails validation before successor launch. |
| Stale claim grief | Cryptoeconomics | Claim expires or is reclaimed after missing progress checkpoints. |
| Sybil skill vote | Cryptoeconomics | New identities cannot swing public skill admission. |
| Stream route failure | Error boundary | Transcript pane keeps historical events visible and offers reconnect instead of going blank. |
| Malformed transcript event | Error boundary | Single event renders as invalid while the rest of the transcript remains readable. |

## Round 3 - Whitehat architecture amendments

### Add proof gates

| Area | Proof gate |
| --- | --- |
| Compliance | Daemon-witnessed probe plus at least one negative side-effect test. |
| Transcript | Local save by default, pre-persistence redaction, hash chain, retention state. |
| Tool gate | Canonical risk class, strict schema, denial event, no hidden side effect. |
| Memory | Retrieval eval, source citations, context budget, degraded-source rendering. |
| Skill graft | Source skill path, expiry, permission delta, independent validation for shared grafts. |
| Spawn | `partition_decision` event, handoff packet, causal closure validation. |
| Launch | Agent Run Saga with idempotency, compensation, timeout, and terminal state. |
| Cloud sync | Explicit user opt-in, encryption state, export/delete, local-only proof. |
| Public harbor | Sybil, oracle, griefing, and front-running table with owners. |
| GPUI panes | Pane-level fallback, retry, cached data, and route-failure tests. |

### Amend the milestone gates

Milestone 1 - Transcript and session truth:

- add secret and PII redaction fixtures before persistence;
- add hash-chain verification;
- record redaction state on every event;
- fail if a transcript event lacks timestamp, provider/body/model tier, session,
  agent, and visibility class.

Milestone 2 - Agent Node registry and compliance probe:

- include a forged-adapter negative test;
- distinguish adapter self-report from daemon-witnessed evidence;
- add compliance downgrade events.

Milestone 3 - Setup, doctor, and account foundation:

- `pd doctor` checks transcript redaction config, hook hash, MCP hash, Keychain,
  local-only state, cloud sync state, and app route health;
- remediation is one click where possible and exact when not possible.

Milestone 3.5 - Minimal governance substrate:

- require path and environment authority for official launches;
- add destructive action no-side-effect test;
- add MCP/script manifest drift test;
- add pre-tool schema rejection fixture.

Milestone 4 - Operator control panel:

- add route-failure, stream-disconnect, malformed-event, and missing-transcript
  visual fixtures;
- every pane must show stale time, last successful refresh, and repair action;
- no raw numeric selection for normal use.

Milestone 5 - Tool gate and suggestibility:

- add tool-loop caps;
- persist tool denials and schema rejections as transcript events;
- record turn-start context envelope and what was omitted due to budget.

Milestone 6 - Context, memory, and transcript search:

- add retrieval eval corpus;
- require retrieval@5, citation precision, P95 latency, hallucination rate, and
  context-utilization reporting;
- add token ledger per agent-task;
- add `partition_decision` and `handoff_packet` events.

Milestone 7 - Skills and grafting:

- skill grafts expire;
- shared skills need provenance and independent validation;
- transcript-derived skills remain quarantined until review.

Milestone 8 - Cooperative governance:

- add claim progress checkpoints;
- add stale-claim reclaim tests;
- add context-publication budget impact;
- add parley audience and expiry.

Milestone 9 - Harbor Editor wedge:

- editor ops are event-sourced;
- each op has author, claim relation, and recovery path;
- out-of-claim writes become shadow edits or require escalation.

Milestone 10 - Cloud, mobile, account, and public harbor:

- no public harbor without Sybil, oracle, griefing, and front-running tables;
- no cloud vault without account KMS threat model;
- no hosted agents without Agent Run Saga tests;
- no mobile control without remote interrupt and revocation race tests.

## Required new ADRs

1. Agent Run Saga ADR:
   Durable launch, attach, control, billing, transcript, and receipt lifecycle.

2. Transcript Redaction And Retention ADR:
   Local-save default, pre-persistence redaction, cloud-sync opt-in,
   tombstones, degraded derived memory, export/delete.

3. Cryptoeconomic Harbor Governance ADR:
   Sybil controls, griefing controls, oracle trust, bonds, reputation, appeal,
   and public-harbor accepted risks.

4. Context Budget And Partition Decision ADR:
   ContextEnvelope, token ledger, per-reader digests, split cost, stay cost,
   causal closure, and handoff packets.

5. GPUI Resilience ADR:
   Pane-level failure boundaries, cached fallback, retries, route-health
   fixtures, and visual artifact requirements.

## Accepted risks

These are acceptable only for early local-only milestones. They are not
acceptable for hosted or public harbor launch.

| Risk | Likelihood | Impact | Trigger to revisit | Owner | Current defense |
| --- | --- | --- | --- | --- | --- |
| Local transcript captures sensitive project data by default | Medium | High | Before cloud sync, team harbor, or public release | Security / Harbor Staff | Local-only default, redaction before persistence, export/delete, visible retention |
| Single-operator reputation is weak | Medium | Medium | Before team/public harbor | Governance | Narrow local authority, no public ranking, explicit accepted-risk status |
| Token estimates are approximate | High | Medium | Before automatic paid spawning | Memory / Cost | Conservative budgets, output reserve, token ledger with estimator confidence |
| Adapter support differs by provider | High | Medium | Before marketing a provider as C4+ | Anode / Integrations | Compliance ladder and disabled controls for missing capabilities |
| Hidden reasoning is unavailable for many bodies | High | Low | Whenever transcript UI changes | Product / Trust | Label visible messages, tool traces, and provider-exposed summaries honestly |

## Updated architecture principle

An official Port Daddy agent is not just an agent that "checks in." It is a
bounded, transcripted, policy-governed, budgeted, source-linked, recoverable
saga participant.

The operator should be able to ask four questions at any time:

1. What is this agent allowed to do?
2. What has it actually done, according to daemon-witnessed evidence?
3. What will happen if I interrupt, resume, fork, or retire it?
4. What proof lets another agent or human trust this history later?

If the system cannot answer those questions, the body can still be observed,
but it is not an official Port Daddy agent yet.

## Whitehat conclusion

The plan is viable if the next implementation work resists two temptations:

- do not build cloud, marketplace, or public-harbor features before the local
  proof chain is real;
- do not use the native app as a pretty display for weak data.

Build the local Agent Run Saga, transcript redaction, compliance probes,
ContextEnvelope, and pane-level recovery first. Then the bigger swarm dynamics
become a product advantage instead of a pile of hopeful vocabulary.
