# 00 PRD, Technical Roadmap, And Integration Test Plan

Status: canonical front door for the Agent Harbor binder.

Purpose:
  Give the operator and future agents one place to answer what we are building,
  why it matters, what order to build it in, what proves it works, and which
  seductive ideas are explicitly not now.

This file is the carry-forward note. If a later conversation changes the
product direction, update this file or the Architect-of-Record log. Do not
leave a core decision only in chat, screenshots, or a transient Port Daddy note.

## Product Requirement

Port Daddy becomes the control plane for AI software work.

A developer should be able to start with one intent:

> Build this feature, keep it safe, show me what happened, and let me step in.

Port Daddy turns that intent into a governed agent team:

1. Understand the work.
2. Decide whether it needs one agent, a scout, a coordinated team, or a durable
   infrastructure helper.
3. Attach the right skills, rules, budget, worktree, and provider/body.
4. Refuse to launch if the agent cannot be observed, governed, or repaired.
5. Open a capture-ready Porthole before embodied action so people and agents can
   see the available perspectives, point, comment, and negotiate bounded
   control while the work happens.
6. Stream visible messages, tool calls, files, diffs, costs, blocks, decisions,
   effects, completeness, and gaps with their evidence class.
7. Let the operator interrupt, steer, fork, resume, retire, or join the work
   live without confusing presence with authorization.
8. Seal the live session into historical evidence and produce a signed Work
   Receipt with transcript, diff, cost, tests, PR state, decisions, evidence
   references, disclosure state, and resume point.

The product is not another chat window. It is the place where Claude Code,
Codex, local models, Cloudflare workers, custom agents, and future bodies become
legible, controllable, and accountable.

## Target Users

Primary user:
  A senior engineer, founder, or tech lead running AI coding agents on real
  repos and already feeling the pain of blank terminals, missing transcripts,
  duplicated work, unsafe git, stale PR comments, and unclear ownership.

Secondary users:

- indie builders who want a beautiful local app instead of three CLIs;
- teams that need agent work to be auditable before they trust it;
- extension authors building custom agents, MCPs, scripts, or cloud workers;
- future mobile users who want to observe and steer long-running work from a
  phone without exposing everything to a hosted service.

## Job Stories

When I ask an agent to build software, I want Port Daddy to record the session,
files, tools, costs, and decisions so I can trust the result and resume it later.

When multiple agents could help, I want Port Daddy to form a small team and show
why each agent was chosen, what skills it received, what it may touch, and what
risks remain.

When an agent is missing hooks, transcript streams, MCP access, or safety gates,
I want Port Daddy to block launch and offer repair, not show a hollow "running"
state.

When an agent tries a destructive or expensive action, I want Port Daddy to stop
it before side effects and offer safer choices.

When context gets long, I want a Longshoreman to compact with citations from
the transcript and files, not summarize from vibes.

When work is done, I want a Work Receipt I can inspect, share, verify, search,
and use as a resume point.

When a person or another agent needs to collaborate, I want them to open the
same live body, point at the exact target, comment, request or hand over bounded
control, and later return to the same witnessed moment.

When I invoke someone else's skill, agent, or model against private data, I want
separate input, execution, observation, output, and disclosure grants; denied
egress; and compatible signed receipts without pretending ordinary containers
prove two-sided secrecy.

## Non-Negotiable Acceptance Criteria

The architecture is real only when these pass against daemon truth, not cached
UI state:

1. `pd-console` can show active and recent Agent Nodes in conjoined panes.
2. Clicking an Agent Node shows live stream if active and saved transcript if
   historical.
3. Transcript events include timestamps, provider, body, model tier, model name
   when safe, tool calls, shell commands, file touches, costs, denials, and
   session lifecycle.
4. Relative paths resolve to absolute repo/worktree paths and can open file
   previews.
5. Compliance is probed and downgraded when forged, missing, or stale.
6. Controls are enabled only when the daemon can actually enforce them.
7. A destructive git fixture is blocked before side effects.
8. A missing hook or transcript path produces repair guidance.
9. Local transcripts are saved by default. Cloud sync is separate and opt-in.
10. A completed run emits a Work Receipt that verifies transcript and diff
    hashes after daemon restart.
11. A local Porthole reaches `capture-ready` before an embodied action, supports
    attributable person/agent pointing and comments, enforces one revocable
    target-bound ControlLease, and reopens as sealed history after restart.
12. Every historical assertion carries `witnessed`, `reported`, `derived`,
    `inferred`, or `unavailable`; projection and search fixtures cannot promote
    it silently.
13. FleetBar or Grand Harbor opens an active or recent worker's real Porthole
    and shows source identity, capture health, current controller, completeness,
    gaps, and unsupported perspectives.
14. A signed rented-capability fixture denies ungranted network/egress, emits
    only its typed output, and returns compatible receipts without customer
    secrets or provider implementation material.

## Big Ideas We Embrace

### Work Intent, not launch-verb soup

The operator gives Port Daddy one Work Intent. The daemon shapes it into a Work
Plan and materializes one or more Agent Nodes. Old words such as dispatch,
sortie, spawn, conjure, cloud fleet, or bridge can survive as compatibility
entrypoints, but they must not own independent runtime truth.

### Agent Node as the official object

An Agent Node binds identity, body, provider, model tier, session, transcript,
worktree, claims, controls, costs, memory scope, and compliance level. If those
are scattered, the product will keep looking fake.

### Compliance is witnessed, not claimed

The daemon witnesses registration, transcript, tool gate, suggestibility,
control, cooperation, and resume capabilities. Bodies cannot declare themselves
compliant. They can only pass probes and receive leases.

### Transcripts are the learning substrate

Save visible local transcripts by default. Notes remain append-only and useful
for explicit handoffs, claims, and commitments, but transcripts should capture
the ordinary work without forcing agents to write manual status prose.

### Cooperative stage first, witness second

Porthole is the live cooperative session protocol and the historical evidence
substrate for concrete Bodies. Freeze `PortholeStage`, `BodyAdapter`,
perspectives, `ControlLease`, capability and evidence-class contracts before
adapters diverge. The local stage begins capture-ready before action and seals
the same session afterward. Advanced governance, remote rooms, device breadth,
and marketplace UX may be phased; the protocol is not deferred with them.

Grand Harbor owns institutional truth, Porthole owns experiential evidence, the
append-only ledger owns causal history, and authorized cited search connects
them. None silently substitutes for another.

### Contract-net magic, plain-language surface

The advanced idea is contract-net work allocation. The user-facing experience is
simple: agents offer plans, Port Daddy recommends a team, and the operator can
see why. "Contract net" belongs in inspect mode and architecture docs, not as
the first label a user must understand.

### Skill grafting as visible preparation

Skills are not hidden prompt seasoning. They are attached instructions shown on
the team proposal and run receipt: which skills, why they matter, and which
agent got them.

### Enforcement beats hope

If Port Daddy can interrupt and block, we should not rely on agents voluntarily
remembering every command. Use hooks, adapters, MCP gateways, capability
leases, and pre-tool gates to shrink the command surface.

### Local-first authority with optional cloud

The local daemon owns the local harbor. Cloud, mobile, relay, hosted agents,
vault, team harbor, and public harbor are explicit extensions. They do not come
before local transcript/control truth.

### Beautiful operator surfaces

The operator should click, inspect, and steer. They should not type numeric ids
to open an active session. The CLI remains powerful for agents and emergencies;
the native app is the main human surface.

## What We Toss Or Park

Park their full product implementation until after local Agent Node and
Porthole truth:

- public harbors;
- marketplace and trust economy;
- broad website promises;
- mobile-first control;
- cloud billing;
- full Harbor Editor collaboration;
- hosted remote swarms;
- training/fine-tuning pipelines;
- elaborate art and marketing pages not backed by live proof.

The live-session, BodyAdapter, ControlLease, signed capability-invocation,
epistemic-class, completeness, gap, and disclosure contracts are not parked.
They belong in F0 even when remote stages, confidential execution,
marketplace listing/pricing/settlement, and broad device support ship later.

Toss as product direction:

- separate runtime concepts for dispatch/sortie/spawn/conjure;
- dashboards that infer agent state from scattered notes;
- "LIVE" badges without transcript or heartbeat evidence;
- operator flows that require typing ids when rows/cards can be clicked;
- pretending an observed or unmanaged agent is compliant;
- model-specific marketing language where `fast`, `mid`, `strong`, `local`, or
  `custom` is the actual user-level choice;
- deleting notes or transcripts to keep surfaces tidy;
- building a whole editor before transcript, registry, and control truth exist.
- treating Porthole as Parley replay or a recorder that receives cooperation
  after its transport and evidence contracts are fixed.

## Technical Roadmap

The roadmap has one serial foundation, then parallel chains.

### F0 - Contract Freeze

Freeze the v0 executable contract:

- `WorkIntent`
- `WorkPlan`
- `AgentNode`
- `AgentRun`
- `PortholeStage`
- `BodyAdapter`
- `Perspective`
- `ObservationBundle`
- `PortholeControlLease`
- `CapabilityGrant`
- `ActionIntent`
- `EffectReceipt`
- `InvocationReceipt`
- `EvidenceClass`
- `POVCompletenessReceipt`
- `DisclosureReceipt`
- `TranscriptEvent`
- `ControlCommand`
- `ComplianceProbeResult`
- `CostAccrualEvent`
- `ContextEnvelope`
- `SkillGraft`
- `WorkReceipt`

Gate:
  Every user-visible control maps to a command, query, event, signed capability
  or explicit unsupported state. The contract distinguishes presence from
  authority, action acknowledgement from witnessed effect, and all five
  evidence classes. UI cannot invent truth.

### C1 - Ledger And Projections

Build append-only event/evidence storage and projections for roster,
transcript, Porthole stage/perspective state, action/effect/gap/disclosure,
files touched, costs, claims, compliance, and receipts.

Gate:
  Projections rebuild from scratch after daemon restart. Duplicate events are
  idempotent. Unknown schema fields are tolerated.

### C2 - Adapters And Compliance Probes

Implement probes and adapters for:

- Codex CLI;
- Claude Code hooks;
- Cloudflare worker bodies;
- Ollama / LM Studio;
- custom stdio or HTTP agents;
- observed imports;
- exact-window, terminal, browser, editor and app-SDK `BodyAdapter`
  conformance, with unsupported modalities explicit.

Gate:
  One compliant body, one weak body, one observed body, and one malicious fixture
  all display different, accurate states.

### C3 - Operator Control Panel

Make `pd-console` the proof surface:

- conjoined active/recent roster and detail panes;
- live stream renderer;
- historical transcript renderer;
- live Porthole join/view/point/comment/control state and sealed evidence
  inspector;
- file preview and absolute path resolution;
- provider/model/cost/context/compliance display;
- click controls for interrupt, steer, checkpoint, successor, retire.

Gate:
  No ordinary operator action requires typing an id. Live and historical
  states descend to their source-classified evidence; screenshot, GIF and
  recording proof remains labeled by the modality it actually witnessed.

### C5 - Governance And Tool Gates

Implement pre-tool and post-tool enforcement:

- destructive git blocker;
- approval request/result;
- denial receipts;
- tool result persistence;
- safe alternatives.

Gate:
  Destructive git fixture has no side effect, and denial appears in transcript
  and Work Receipt.

### C8 - Setup And Doctor

Make the harness installable and repairable:

- signed app / CLI / daemon / hooks / MCP config;
- transparent hook names;
- transcript path checks;
- Keychain/provider key checks;
- stale version checks;
- one-click remediation where possible.

Gate:
  Broken hook, missing provider key, disabled MCP, and stale daemon fixtures all
  produce repair cards and retest.

### C4/C6/C7 - Memory, Skills, And Advanced Cooperation

After the minimal local Porthole live-to-history and control truth:

- context pressure tracking;
- cited compaction packets;
- transcript search;
- skill discovery and grafting;
- skill proposal from transcripts;
- file/symbol claims;
- semantic conflict prediction;
- parley and blackboard cards.

Gate:
  A context-pressure fixture creates a cited compaction packet, a missing skill
  produces remediation, and two overlapping agents trigger visible conflict
  handling.

### Priority Program - Postmaster And Plan-First Continuity

Chapter 28 is a high-priority program because coordination that exists but is
not delivered is operationally absent. Ship bounded inbox/parley and salvage
nudges first; then plan checkpoints, repository PR digests, provenance-bearing
roadmap/document/AST suggestions, Fleetbot settlement receipts, and
context-clustered successor workgroups. Activate the named Postmaster ship only
after local ship identity, supervision, and operator projection are real.

Gate:
  Crash, compaction, takeover, new-review, merged-PR, and overlapping-work
  fixtures each produce one bounded, idempotent next action backed by durable
  plan, cursor, packet, or settlement evidence.

### Later - Full Harbor Editor, Remote Stages, Mobile, Cloud, Teams, Marketplace

Only after local Agent Node truth works:

- Loro Harbor Editor wedge;
- mobile observer/control;
- encrypted transcript sync;
- hosted remote agents;
- BYOK cloud vault;
- team/public harbors;
- billing and export/delete controls;
- marketplace discovery, pricing, settlement and dispute flows;
- attested confidential execution for the strongest mutual non-exfiltration
  claim.

Gate:
  Local-only mode proves no upload. Cloud mode proves explicit pairing,
  encryption, budget, and delete/export. Provider-IP/customer-data secrecy is
  labeled `unavailable` until the chosen confidential-execution profile passes
  measurement, key-release, egress, output and revocation tests.

## Milestone Gates

| Milestone | Outcome | Hard gate |
| --- | --- | --- |
| M0 Canon | Binder and glossary aligned | AOR contradiction process exists; Porthole/body/evidence contracts are in F0 |
| M1 Perspective Truth | transcript and POV absence are visible | Codex or Claude body emits transcript events; every requested modality has evidence class and completeness state |
| M2 Agent Registry | compliant vs non-compliant is real | registry/probe distinguishes compliant, weak, observed, fake |
| M2.5 Agent Lab | agents can be tested before prod | dry-run/probe returns plan without launch |
| M3 Setup/Doctor | install and repair are humane | broken setup fixture repairs or explains |
| M3.5 Governance | controls are not decorative | destructive git blocked before side effect |
| M4 Control Panel | operator can click, stream, join and inspect | active and past Agent Nodes render from daemon truth; one local Porthole passes PH-01 |
| M5 Suggestibility | Port Daddy gets in front of turns/tools | turn-start guidance and tool gates visible |
| M6 Memory/Search | transcripts become reusable memory | cited compaction and transcript search work |
| M7 Skills | grafting is explicit and validated | user-mentioned skill reaches agent; missing skill remediates |
| M8 Advanced Cooperation | agents coordinate safely | conflict/parley shown and recorded over the already-frozen Porthole protocol |
| M9 Harbor Editor | humans and agents co-edit safely | local Loro edit + claim-aware agent edit works |
| M10 Cloud/Mobile/Teams | harbor spans devices/users | phone interrupts remote agent; local-only uploads nothing |

## Integration Test Matrix

### IT-001 Transcript Event Contract

Fixture:
  Simulated body emits operator, assistant, tool, shell, file, denial, and end
  events.

Verify:

- schema validation;
- monotonically increasing sequence;
- timestamps present;
- hash chain valid;
- unknown fields tolerated;
- replay after daemon restart.

### IT-002 Agent Node Join

Fixture:
  One session, one body, one transcript stream, one worktree, one provider.

Verify:

- roster query returns one Agent Node;
- detail query returns body/provider/model/worktree/session/transcript;
- missing join produces explicit non-compliance reason.

### IT-003 Codex Or Claude Local Compliance

Fixture:
  Launch or attach one local body through the current best adapter.

Verify:

- C0 registration;
- C1 transcript;
- provider/model tier;
- files touched;
- stop reason;
- historical transcript after restart.

### IT-004 Weak And Observed Agent Honesty

Fixture:
  Import a log-only or unmanaged agent.

Verify:

- shown as observed/unmanaged;
- controls disabled;
- remediation explains missing transcript/tool gate;
- UI never labels it compliant.

### IT-005 Destructive Git Gate

Fixture:
  Agent attempts `git reset --hard`, `git clean -fd`, or equivalent destructive
  action in a dirty worktree.

Verify:

- command blocked before side effect;
- denial event recorded;
- safe alternatives offered;
- Work Receipt includes denial.

### IT-006 Turn-Start Suggestibility

Fixture:
  Agent starts a new turn while inbox, repo update, conflict warning, skill graft,
  and memory packet are available.

Verify:

- guidance envelope delivered;
- transcript records delivery;
- agent body receives only scoped context;
- oversized context is summarized with citations.

### IT-007 Skill Graft And Missing Skill

Fixture:
  One work plan requires `build-coop-ide-gpui`; another requires a missing skill.

Verify:

- present skill appears on proposal, transcript, and receipt;
- missing skill blocks launch or downgrades readiness;
- doctor remediation names the missing package/path.

### IT-008 pd-console Live And Historical Render

Fixture:
  Daemon serves one active stream and one completed transcript.

Verify:

- active list row click opens live transcript;
- completed row click opens historical transcript;
- no numeric id entry required;
- timestamps, provider/model, files, notes, claims, cost, and controls visible;
- pane failure does not blank the app.

### IT-009 Work Receipt Verification

Fixture:
  Completed Agent Node with transcript, files, diff, cost, and PR link.

Verify:

- receipt hash matches transcript chain and diff hash;
- receipt can be verified after restart;
- predecessor/successor links preserve old evidence.

### IT-010 Setup And Doctor Remediation

Fixture:
  Broken hook, disabled MCP, missing provider key, stale daemon, unwritable
  transcript path.

Verify:

- each state is detected;
- repair action exists where safe;
- retest updates readiness;
- hook names/descriptions are transparent.

### IT-011 Context Compaction

Fixture:
  Agent crosses configured context-pressure threshold.

Verify:

- Longshoreman creates cited compaction packet;
- packet references transcript events, files, claims, and commitments;
- successor can launch from packet;
- original transcript remains append-only.

### IT-012 Cloudflare Remote Body

Fixture:
  Cloudflare development worker and production-like remote body.

Verify:

- remote authority labeled;
- cost/budget visible;
- interrupt command reaches remote body or fails honestly;
- local-only mode uploads nothing.

### IT-013 Custom Agent API

Fixture:
  Minimal stdio or HTTP custom agent targets the protocol.

Verify:

- can register, stream, request tool preflight, complete, and emit receipt;
- forged compliance downgraded;
- missing capability produces partial compliance, not failure theater.

### IT-014 Projection Rebuild

Fixture:
  Event ledger with active, completed, failed, and malformed runs.

Verify:

- projections rebuild exactly;
- malformed events quarantine without losing the rest;
- stale projections are labeled and never authorize commands.

### Porthole Conformance Gates PH-01..PH-07

Chapter 29 owns the cross-cutting live-to-history gates for:

- a local person/agent Porthole with one bounded ControlLease;
- multiplayer browser/app test derivation;
- live Fleet Porthole entry and honest unavailable states;
- customer-bound rented capability invocation and denied egress;
- provider-IP/confidential-execution honesty;
- epistemic downgrade across projection and search; and
- Sugar/Parley protocol independence.

These are part of this PRD's acceptance matrix. They use a separate `PH-`
namespace because chapters 19 and 22 already continue the `IT-` sequence from
IT-015.

## Agent Work Packets

Launch work only when each packet has input, output, owner, and proof gate.

Immediate sequence:

1. F0 contract freeze.
2. PH-01 local live-to-history vertical slice across C1/C2/C3/C5.
3. C1 ledger/projections.
4. C2 compliance probes and BodyAdapter conformance.
5. C3 operator control panel and Porthole inspector.
6. C5 governance/tool gate.
7. C8 setup/doctor.

Parallelization rule:
  F0 is serial. After F0, C1/C2/C3/C5/C8 can proceed in parallel if they agree
  on schema names and the integration agent owns merge order.

Do not launch separate agents for cloud/mobile/full-editor/marketplace product
implementation until C1-C5 and PH-01 have a passing local proof. Their
cross-runtime, capability, evidence and disclosure contracts are still frozen
in F0.

## Current Source-Of-Truth Stack

Read in this order:

1. This file.
2. `README.md` for glossary and binder map.
3. `18-build-prescription-agent-launch-board.md` for current work orders.
4. `07-milestones-and-work-dag.md` for full milestone order.
5. `03-agent-contract-and-extension-api.md` for compliance/protocol.
6. `09-data-model-and-api.md` for daemon records and APIs.
7. `10-operator-control-panel.md` for native app behavior.
8. `29-porthole-cooperative-body-and-evidence.md` for the live body/evidence
   contract and Porthole proof gates. ADR-0135 in active PR #9970 remains its
   decision authority until reconciled into `main`.
9. `frame0/user-story-and-figma-brief.md` for product-language and UI story.
10. `16-binder-architect-of-record.md` for contradiction handling.

If these disagree, this file names the current product commitment, but schema,
ADR, and runtime tests supersede prose once they exist.

## Open Risks

- Existing code still has legacy launch paths with independent names and habits.
- Current `pd-console` can show panels before the runtime contract is real.
- Claude Code and Codex transcript/control hooks have different capabilities.
- Same-UID local processes are hard to contain honestly.
- Cloudflare bodies need remote authority, cost, and interruption semantics that
  do not pretend to be local.
- Transcripts saved by default require strong local retention/export/delete UX
  before cloud sync or team sharing.
- Current Porthole work is split across active, blocked/dirty PRs; binder
  convergence does not prove merge, installation, capture, or live cooperative
  behavior.
- Ordinary sandboxes can reduce exfiltration risk but cannot prove both
  customer-data secrecy and provider-IP secrecy against mutually distrustful
  parties; confidential execution and leakage-policy decisions remain open.
- The evidence-class vocabulary needs one schema owner and migration rule when
  ADR-0135 contracts reconcile, or projections may drift into silent promotion.
- The binder is large enough that contradiction drift is likely unless the AOR
  process is treated as product infrastructure.

## Revisit Trigger

Revise this PRD when any of these becomes true:

- F0 produces schemas or ADRs that disagree with this document;
- a real adapter proves a compliance level impossible or easier than expected;
- `pd-console` demonstrates a better first-run interaction than Start Work ->
  Team Proposal -> Live Build Room -> Proof;
- local transcript retention creates a privacy or performance problem;
- a customer/user chooses a different primary value proposition than agent
  control and proof.
