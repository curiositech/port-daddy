# 19 Operator Surface Triad: Scout, FleetBar, And pd-console

Status: surface placement chapter and messaging-substrate contract.

Purpose:
  Place the three operator client surfaces — the Scout browser extension, the
  FleetBar menu-bar app, and the `pd-console` native app — in one architecture,
  formalize the hot-path/durable-path message substrate they share, and state
  the product position on what the Port Daddy MCP becomes once coordination is
  enforced rather than suggested.

This chapter extends `01-product-and-surfaces.md`. Chapter 01 lists every
surface; this chapter owns the *division of labor* among the three surfaces an
operator touches most, and the bus contract underneath them. Where the two
disagree, the Architect of Record logs it per chapter 16.

## The triad thesis

One operator, three distances from the work:

| Surface | Distance | Job | One-line contract |
| --- | --- | --- | --- |
| Scout (Chrome extension) | *inside the artifact* | intake and observation at the point where the operator sees the product misbehave | turn what the operator is looking at into a Work Intent, with evidence attached |
| FleetBar (macOS menu bar) | *ambient, glanceable* | presence, consent, and re-entry | the only surface allowed to demand the operator's attention, and only for human gates |
| pd-console (GPUI native app) | *deep, seated* | inspection, steering, transcripts, files, claims, editing | the proof surface where daemon truth is rendered in full |

The rule that keeps the triad honest:

> Scout captures intent. FleetBar grants consent. pd-console shows the truth.
> No surface owns runtime state; all three render daemon truth and submit
> commands through the same envelopes.

This is the same authority rule as chapter 01 ("surfaces differ in affordance,
not authority") made concrete: the three surfaces differ in *which* commands
and queries they expose, never in where truth lives.

Non-triad surfaces are unchanged by this chapter: the `pd` CLI remains the
agent/emergency surface, the website remains accounts/distribution, mobile
remains a capability-scoped observer (chapter 01), and editor plugins remain
thin clients.

## What exists today versus target

Shipped in the repo (verified paths, this commit):

- `apps/pd-scout-extension/` — MV3 extension v0.1.0: `chrome.tabs.captureVisibleTab`,
  Shadow-DOM region picker, DOM selector/XPath/bounds sampling, one envelope to
  `POST /visual-tasks` on the local daemon.
- `routes/visual-tasks.ts` — daemon intake: persists screenshots via `/blob`,
  publishes to the `visual-feedback` channel, optionally messages a target agent
  inbox, opens a reviewable work item.
- `apps/FleetBar/` — SwiftUI menu-bar app: popover, dispatch/approve store
  (`DispatchStore.approve`), inbox route, cost dashboard, budget pause store,
  secrets view, and a WebView shell for the `/fleet-ui/` surface.
- `apps/pd-console` GPUI console — panes and mux model (chapter 01, chapter 10).

Target-only until proven by the gates below:

- Scout as a Work Intent source with a traceable intent id (today `/visual-tasks`
  is a bridge intake, not yet routed through `WorkIntentService`);
- FleetBar rendering daemon-issued human-gate payloads (today approvals are
  fleet-dispatch approvals, not chapter-18 C5 gate envelopes);
- the hot-bus digest subscription for FleetBar and Scout (today both poll or
  subscribe to channel-specific SSE);
- pd-console transcript truth per milestones M1–M4;
- any triad behavior on non-macOS hosts.

## Scout: intake at the point of observation

Scout is the wedge that no chat window can copy: the operator is looking at
their running product, sees the defect, and files it *from inside the
viewport* with the evidence already attached — screenshot, DOM path, region
bounds, URL, viewport size.

Placement rules:

1. Scout is an intake and observation surface only. It never receives shell,
   file, or repo capabilities. Its host permissions stay loopback-only
   (`http://127.0.0.1:*`, `http://localhost:*`) until device pairing exists.
2. A Scout submission is a Work Intent source of kind `scout`, not a launch
   verb. It enters the same `WorkIntentService -> WorkPlanner -> AgentNodeService`
   chain as every other intake (chapter 14). `POST /visual-tasks` survives as a
   compatibility bridge until the Work Intent API lands, and is then demoted to
   an alias exactly like `spawn` (chapter 02 migration table).
3. Scout renders agent responses (the ask-agent panel) only from daemon truth:
   roster, compliance level, heartbeat. It never shows a LIVE badge without
   stream evidence — the chapter 10 rule applied to the browser.

Full technical specification, wire schemas, security model, and proof gates:
`work-packets/scout-extension-technical-spec.md`.

## FleetBar: ambient consent and re-entry

FleetBar's reframe (from the interactive mockup, adopted here as product
direction): **the fleet is plumbing; the front door is intent.**

The popover opens to four verbs, not a roster:

1. a command bar — "what do you want to do" (a Work Intent composer);
2. pending human gates — the only items allowed to demand the operator;
3. resume — recent projects/sessions as physical re-entry points;
4. quick actions — show me what you built, catch me up, talk to the fleet,
   open the fleet drawer.

The fleet roster is a drawer, reachable but secondary. Cost appears at the
consent gate (when authorizing a team) rather than as ambient per-agent
anxiety.

Placement rules:

1. FleetBar is the *consent* surface. Chapter 18's C5 human-gate payloads and
   denial receipts render here first, because the menu bar is where an
   approval can interrupt politely.
2. FleetBar is read/write/suggest in exactly this sense: read = the six-state
   glance grammar; write = approve/deny/modify, interrupt, resume, and intent
   submission; suggest = the daemon's team proposals and turn-start
   suggestions surfaced as "waiting on you" cards.
3. FleetBar never renders a control the daemon cannot enforce (chapter 00
   acceptance criterion 6). An observed agent shows state, never buttons.

Full technical specification, popover state machine, six-state grammar, design
token contract, and proof gates:
`work-packets/fleetbar-technical-spec.md`.

## pd-console: the deep surface

pd-console keeps the charter it already has in chapters 01 and 10: conjoined
roster/detail panes, live stream and historical transcript renderers, files
and diffs, claims, costs, compliance, click-first controls, and eventually the
Harbor Editor wedge (milestone M9).

What this chapter adds is the boundary against the other two surfaces:

- Anything that requires reading more than one screen of evidence belongs in
  pd-console, not FleetBar. FleetBar deep-links into pd-console rather than
  growing panes.
- Scout's ask-agent panel is a scoped conversation, not a console. If the
  operator needs transcript history, files, or steering beyond a reply, Scout
  deep-links into pd-console with the session id.
- pd-console is the only triad surface that renders transcripts in full and
  the only one that will host editing. This keeps the GPUI investment focused
  where `build-coop-ide-gpui` and the Layer A/Layer B parley contract already
  point.

## The hot bus and the cool bus

Promoted from `work-packets/swarm-invocation-and-node-shaping.md` to chapter
truth. Two planes, never one transport doing both jobs:

| Plane | Carries | Transport | Persistence |
| --- | --- | --- | --- |
| Hot bus | presence, current step, stream cursors, steering, pause/cancel intents, small status deltas, high-frequency swarm chatter | ONE choice: a multiplexed loopback WebSocket per surface connection (in-process bus inside the daemon) | ephemeral, replaceable, summarized at checkpoints |
| Cool bus | Work Intents, plans, claims, transcript events, control commands, gate decisions, costs, receipts, inbox messages | append-only event ledger, notes, actor inboxes | append-only, replayable, attributable (chapter 09 schema) |

Transport decision, stated once so it stops being a menu: the hot bus is **one
multiplexed WebSocket** per connected surface. WebSocket because steering is
bidirectional — pause/cancel/steer intents ride the same channel as state
deltas, which server-push-only transports cannot do. The daemon's existing
per-channel SSE endpoints are bridges on the same deprecation path as the old
launch verbs: intake metadata, then aliases, then gone. No new surface may add
a second push transport; a surface that needs a new stream subscribes to a new
topic on the same socket.

The checkpoint rule, verbatim: *hot messages may move the UI quickly; durable
events decide history.*

Latency budgets (from the swarm-invocation packet, binding for the triad):
live board p95 < 250 ms; steering p95 < 100 ms; local IPC hop < 10 ms;
loopback WebSocket hop < 25 ms; durable append < 500 ms per checkpoint. Cancel
and pause never block on durable append but must emit a durable follow-up once
acknowledged.

How each surface subscribes:

| Surface | Hot bus | Cool bus |
| --- | --- | --- |
| Scout | hot-bus topics scoped to its own submissions only | submits Work Intents; reads its intents' status and receipts |
| FleetBar | one multiplexed digest stream: roster states, current steps, pending gates, cost ticks | approval decisions, intent submissions, resume queries |
| pd-console | full per-session stream frames, presence, claims awareness | everything: ledger queries, transcript replay, receipts, search |

Inbox messages are cool-bus objects: durable, attributable, delivered at
turn start through the suggestibility envelope (chapter 03), never lost when a
surface is closed. High-frequency swarm messages are hot-bus objects: two
agents negotiating a parley cadence or streaming progress do not write one
durable event per heartbeat. The Longshoreman summarizes hot traffic into cool
checkpoints — that is the whole point of having two buses.

Interrupt semantics across the triad: an interrupt issued from any surface is
a hot-bus intent plus a durable `ControlCommand`. The hot path makes it fast;
the cool path makes it undeniable. A body that only honors the durable command
is slow but compliant; a body that honors neither is downgraded (chapter 03
compliance ladder) and its interrupt buttons disable everywhere at once.

## Navigation and Seamanship

Two capabilities that today live outside the product as Jury-rig tooling become
first-class Port Daddy concepts, named for the harbor. This is a
centralization move, not an addition: the external tools are engines behind
existing binder concepts, and their old names stop being product vocabulary.

**Navigation** is the act of turning a Work Intent into a plan: sensemaking,
decomposition into a DAG or hypertree of nodes, skill selection per node,
premortem, synthesis. Chapter 14's `WorkPlanner` *is* the navigator — this
term names what it does, and the Jury-rig next-move meta-DAG (sensemaker →
decomposer → skill-selector ∥ premortem → synthesizer) is its current engine.
The engine moves into the daemon as the WorkPlanner implementation; it does
not remain a separate external surface the operator has to know about. The
operator-visible artifact of Navigation is the team proposal: which nodes,
which dependencies, which skills, what risks, what cost.

**Seamanship** is the skill system: the indexed catalog, the search cascade
(BM25 → embeddings → rank fusion → cross-encoder → outcome attribution), and
the graft — attaching chosen skills to an Agent Node before launch, visibly.
The Jury-rig `skill_search`/`skill_graft` tools are the current engine; they
become the daemon's skill index and graft service (chapter 04, milestone M7).
The PRD already commits to "skill grafting as visible preparation" — this
names the whole capability, and every navigated node lists its grafted
seamanship on the proposal and the Work Receipt.

Rules:

- Navigation without Seamanship is planning theater. A plan whose nodes name
  no skills is a placeholder, not a plan (chapter 14 placeholder rules apply).
- Vocabulary collapse applies here exactly as it does to launch verbs:
  "Jury-rig", "next-move", "skill-selector", "graft batch" survive as engine
  and implementation names, never as operator-facing concepts. The operator
  sees Navigation (the chart) and Seamanship (the crew's skills).
- Under the enforced MCP below, Navigation requests ride `work` and
  seamanship lookup rides `recall`; graft delivery is part of node
  materialization, not a verb an agent remembers to call.

Gate: a Work Intent submitted from any triad surface produces a team proposal
whose every node names its skills; the same skills appear on the sealed
receipt; and no operator-facing surface, doc, or command mentions the engine
names.

## Tandem truth (2026-07-03)

Work landing in parallel with this chapter, which it must not contradict:

- PR #652 consolidates sanctioned desktop surfaces to **FleetBar, Fleet
  Control Center, and pd-console**, retires the daemon's web dashboard, and
  removes browser-tab escapes. This chapter's triad is consistent with that:
  the Control Center is FleetBar's deep window face (its embedded content is
  the `/fleet-ui/` app), not a fourth surface; Scout is the sanctioned
  *browser-side intake*, which #652 explicitly leaves intact.
- PR #648 ships the first real "Waiting on you": a daemon-persisted HITL
  proposal queue with native Yes/No approval in FleetBar and pending-proposal
  awareness in pd-console. The FleetBar packet treats it as the shipped v1 of
  the human-gate section.
- PR #638 hardens Scout's daemon intake (typed error codes, default blob
  store, an honest Online/Offline daemon chip in the popup) — the Scout
  packet's slice S1, already in flight.
- PR #455 lands the brand color system with an enforced `check-brand-colors`
  gate. All triad token contracts defer to it; mockup palettes are
  placeholders until mapped.

## The MCP once coordination is enforced

Position, stated strongly because the operator asked for one:

**Today's Port Daddy MCP is etiquette. The enforced-coordination MCP is a
capability broker, and it should shrink, not grow.**

Today the MCP surface is ~19 coordination verbs — `begin_session`, `add_note`,
`coordination_preflight`, `acquire_lock`, `claim_port`, `swarm_awareness`,
`end_session_full` — that a well-behaved agent calls voluntarily. Every one of
them encodes hope: the agent *may* announce itself, *may* leave a note, *may*
check for conflicts. Chapter 00 already names the principle that kills this
design: **enforcement beats hope.**

Once a body is C4+ (controllable: the daemon gates its tools and can interrupt
it), the coordination verbs stop being things an agent says and become side
effects of things an agent *does*:

- A file write through the gated tool surface *is* the claim. No
  `session files add` call — the pre-tool gate records the claim, checks
  conflicts, and blocks or warns before the write happens.
- Turn start *is* the inbox delivery. The suggestibility envelope injects
  inbox messages, conflict warnings, and memory packets; no agent polls an
  inbox tool.
- Run completion *is* the note. The receipt seals from witnessed transcript
  events; no agent writes "Result: ..." prose that may or may not match what
  it did.
- Session identity *is* the lease. Registration happens at launch through the
  adapter nonce challenge (milestone M3.5), not through a voluntary
  `begin_session`.

The enforced MCP therefore collapses to five broker tools:

| Tool | Replaces | What it does |
| --- | --- | --- |
| `work` | dispatch/sortie/spawn verbs and ad hoc task tools | submit or refine a Work Intent; the only way to cause new agent work |
| `act` | every direct tool escape hatch | preflight + execute a gated capability: file, shell, network, browser, GitHub. One entry point, one denial shape, one transcript event |
| `ask` | parley notes, human-gate improvisation | open a parley with another agent or request an operator gate; blocks or continues per policy |
| `recall` | memory/search side tools | query episodic memory, transcripts, and the blackboard within the context budget envelope |
| `status` | heartbeat/note prose | report progress, context pressure, and checkpoints in the normalized event shape |

Everything else — notes, claims, locks, sessions, ports as coordination
objects — becomes daemon-inferred state that agents can *read* through
`recall` but no longer have to *volunteer*. Advisory-mode installations (C0–C3
bodies, other people's repos, un-hooked agents) keep the legacy verb surface;
it is the compatibility shim, exactly as `spawn` is for launches. The
migration is the same shape as chapter 14's verb collapse: old tools become
intake metadata for the broker, then aliases, then documentation history.

Two consequences worth naming:

1. **Skills stop teaching etiquette.** A skill that today says "run
   `pd begin`, leave a `pd note`, check claims before editing" becomes a skill
   about the actual work, because the harness guarantees the coordination.
   Skill text shrinks and skill compliance stops being a matter of prompt
   obedience. (This retires an entire class of drift the repo currently
   patrols with guard shims and CLAUDE.md exhortation.)
2. **The MCP becomes the enforcement boundary for third-party MCPs too.**
   Official launches already rewrite MCP config and PATH so the body sees the
   daemon gateway (chapter 03). Under enforced coordination that gateway *is*
   `act`: a third-party MCP server is a capability manifest behind the broker,
   with per-call preflight, redaction, transcript events, and denial receipts.
   An agent that reaches around the broker to a raw MCP endpoint is downgraded
   to observed — witnessed, not trusted.

Gate for this section:

- An agent launched at C4 completes a nontrivial task while calling zero
  legacy coordination verbs, and the daemon's projections still show correct
  session, claims, notes-equivalent events, conflicts, and receipt.
- The same fixture run through a C1 body shows the legacy verbs still working
  and the compliance card honestly reporting "advisory coordination only."

## Skill backing for the triad build

The repo's recent skill corpus — the agentic-coding family (PRs #639, #643,
#644), `agentic-app-architecture` (#646), the workflow-discipline set (#647),
and the standard-upgrade batches (#649, #650, merged) — maps onto the
chapter 18 work orders as follows. Chains graft their row through Seamanship
before starting; the integration reviewer treats a missing graft as a finding:

| Build area | Backing skills |
| --- | --- |
| F0 contracts, invocation shapes | `swarm-invocation-designer`, `agent-interchange-formats`, `agentic-app-architecture` |
| C1 ledger and projections | `sqlite-durable-agent-state`, `cqrs-event-sourcing-architect`, `event-driven-architecture-expert` |
| C2 adapters, trust, spawn path | `fleet-event-spawn-trust`, `agentic-app-architecture`, `llm-router`, `agent-identity-continuity-reputation` (PR #650) |
| C3 pd-console | `gpui-rust-console`, `build-coop-ide-gpui`, `rust-gpui-motion`, `gpui-shaders`, `vello-parley-rendering` (PR #649), `metal-text-pipeline` (PR #649), `metal-shader-expert` (PR #650), `rust-data-structures-advanced` (PR #649), `rust-debugging-mastery` (PR #649), `rust-performance-and-idioms`, `advanced-rust-patterns`, `rust-code-testing` (PR #650) |
| C3 FleetBar | `beautiful-gui-design`, `agentic-coding-ux-designer`, `human-gate-designer`, `design-system-bootstrap`, `color-theory-palette-harmony-expert` (PR #650), `ux-friction-analyzer` (PR #650), `app-sound-design`, `sound-design-and-audio`, `cross-platform-desktop` |
| Scout | `developer-surface-strategist`, `always-on-agent-inputs`, `webapp-testing`, `tunnels-for-agents`, `web-design-expert` (PR #650) |
| C5 governance and gates | `sandboxed-adversarial-test-harness`, `macos-host-security`, `human-gate-designer`, `fleet-event-spawn-trust` |
| C8 setup/doctor | `macos-launchd-supervision`, `daemon-development`, `rust-app-distribution`, `beautiful-cli-design` |
| Receipts and pricing | `agent-work-receipt-designer`, `agent-labor-pricing-function` |
| Product gating and review | `product-roadmap-focus`, `product-reality-reviewer`, `port-daddy-user-surrogate-pm-review`, `agentic-coding-product-research`, `product-appeal-analyzer` (PR #650) |
| Evaluation and training | `agent-rl-sandbox-trainer`, `llm-evaluation-harness`, `webapp-testing` |
| Planning the whole arc | `vibe-project-master-plan`, `agentic-patterns` |
| Workflow discipline (track → ship → steward → hold the bar) | `agent-issue-tracker-workflow` (PR #647), `agent-pr-authoring` (PR #647), `legible-roadmap-with-sidequests` (PR #647), `multi-agent-authoring-product-bar` (PR #647) |

Rule: a chain that starts without grafting its row is under-prepared; the
integration reviewer (work order I0) should treat missing grafts as a finding.
Grafting is a Seamanship act; the engine behind it today is Jury-rig, per the
Navigation and Seamanship section above.

## Proof gates

Continuing the chapter 00 integration test numbering:

### IT-015 Scout Intent Trace

Fixture: submit a region capture from Scout against a local page.

Verify: a Work Intent id exists (or the bridge intake is labeled as bridge);
the screenshot blob persists with retention policy; the responding agent's
compliance level is displayed; daemon offline produces an honest error state
in the popup, not a spinner.

### IT-016 FleetBar Human Gate

Fixture: a C5-gated destructive action triggers an approval request while the
operator is away from pd-console.

Verify: FleetBar surfaces the gate with cost/scope/network access; approve and
deny both land as durable decisions visible in transcript and receipt; the
gate card never renders for a body whose compliance level cannot honor the
decision.

### IT-017 Triad Consistency

Fixture: one agent run observed simultaneously in Scout (ask panel), FleetBar
(digest row), and pd-console (detail pane).

Verify: all three render the same state within the hot-bus latency budget;
killing the daemon degrades all three to the same honest disconnected state;
restart rebuilds all three from ledger truth with no surface remembering
phantom state.

### IT-018 Broker Collapse

Fixture: the enforced-MCP gate from the section above (C4 zero-legacy-verb run
plus C1 advisory run).

Verify: as stated there; plus the C4 run's receipt lists capability grants and
denials from the `act` broker with no self-reported coordination prose.

## Relationship to earlier chapters

- Chapter 01 keeps surface inventory authority; this chapter owns triad
  division of labor. Contradictions go to the AoR (chapter 16).
- Chapter 03's hooks/proxy (Squid) adapter strengths are unchanged; the
  enforced-MCP broker is the C4+ expression of that same gateway.
- Chapter 13's zero-trust amendments (signed leases, replay cache,
  attenuation) apply verbatim to `act` broker calls.
- Chapter 14's verb collapse extends to MCP coordination verbs under
  enforcement, per this chapter.
- The design mockups under `docs/design/fleetbar-mockups/` remain the visual
  source; their technical contracts live in the two work-packets named above
  and supersede the prose embedded in the HTML.
