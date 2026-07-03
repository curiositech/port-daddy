# Operator Control Panel UX Flow

Status: active work packet for the C3 operator control panel slice.

## Mission

Design the first operator flow for official Port Daddy compliant agents: from
describing work, to forming a governed team, to watching live work, to
interrupting or rolling back safely, to sealing a work receipt.

This packet is intentionally UI and product behavior only. It does not create
new runtime truth. The control panel reads Agent Node, transcript, file, cost,
governance, and receipt state from daemon-backed contracts produced by F0/C1/C2
and must label missing truth honestly.

## Source Inputs

- `docs/architecture/agent-harbor-technical-binder/10-operator-control-panel.md`
- `docs/architecture/agent-harbor-technical-binder/frame0/README.md`
- `docs/architecture/agent-harbor-technical-binder/frame0/user-story-and-figma-brief.md`
- `docs/architecture/agent-harbor-technical-binder/18-build-prescription-agent-launch-board.md`
- `core/pd-console/docs/artifacts/gpui/gpui-harness-mux/MANIFEST.md`
- `core/pd-console/docs/artifacts/gpui/proof-live-agent-transcript/MANIFEST.md`
- `core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/MANIFEST.md`

## User Story

As a developer operating Port Daddy, I want to describe software work once,
watch Port Daddy form a skilled and governed agent team, launch only agents that
can be observed and controlled, and keep every transcript, file, stop, cost, PR,
and receipt in one room so I can steer the work without memorizing command IDs.

The first five seconds should say:

- what this is: a control room for AI coding teams;
- what I do next: describe the work;
- why I can trust it: launch is blocked until transcript, worktree, controls,
  cost cap, safety stops, and resume proof are ready;
- where proof appears: live transcript, files, controls, and final receipt stay
  attached to the selected run.

Internal terms such as `Agent Node`, `C5`, `ContractCommand`, and `graft packet`
belong in inspectors and receipts. The first run speaks in operator language:
trusted agent, ready to launch, skills attached, safety stop, proof of work.

## First-Run Flow

### 1. Start Work

The default first screen is a dense, focused work composer, not a roster of
internal objects.

Primary region:

- intent box with examples from the current repo context;
- repo/worktree selector with live branch freshness;
- proof required summary: tests, PR, screenshot/GIF/recording when visual;
- budget and model-strength controls;
- local/cloud data boundary notice.

Click-first actions:

- `Describe work` accepts plain language and drafts a work brief.
- `Attach context` opens file, screenshot, PR, issue, transcript, and memory
  pickers.
- `Use current repo` binds the work brief to the current worktree without asking
  for a path.
- `Check setup` runs the relevant doctor/probe path and reports exact launch
  blockers.

### 2. Work Brief Review

Port Daddy turns intent into a brief before any agent launches.

The review shows:

- goal and non-goals;
- likely files and risky areas;
- expected proof artifacts;
- required skills and rules;
- proposed budget and timeout;
- branch freshness and worktree plan;
- launch blockers with one-click remediation.

Click-first actions:

- `Form team` requests agent offers.
- `Edit brief` returns to the composer with changes preserved.
- `Fix setup` opens Doctor on the failing capability.
- `Save draft` stores the brief as an operator-controlled artifact.

### 3. Team Proposal

The visible magic is a team forming around concrete work. Proposal cards show
roles, not backend taxonomy.

Each card includes:

- role: UI builder, reviewer, context steward, deployer, local explorer;
- why this agent: relevant recent context, skill match, cost profile, or model
  strength;
- body/provider and exact model in the expanded details;
- skills attached, grouped by build, review, security, design, memory, release;
- rules attached: transcript required, file claims required, no destructive git,
  PR proof required, visual proof required when applicable;
- expected touch points: files, worktree, PR, deployment target;
- readiness: launchable, needs setup, sandbox only, or observed only.

Click-first actions:

- `Launch build room` starts only the launchable plan.
- `Swap model` opens constrained alternatives with cost and capability tradeoffs.
- `Inspect skills` opens the exact instruction bundle before launch.
- `Split work` converts one broad proposal into smaller run lanes.
- `Reject plan` requires a short reason so later routing can learn.

### 4. Fix Setup

When a raw backend is not official-agent compliant, the panel should block launch
and explain the missing capability.

Launch blockers include:

- no transcript stream or saved transcript path;
- no session identity;
- no worktree or sandbox;
- no pre-tool safety stop;
- no file-claim path;
- no resume/checkpoint path;
- no cost cap;
- missing provider/model disclosure.

The repair surface shows the failed capability, impact, what Port Daddy will
change, privacy implication, sandbox test result, and a safe repair button. It
never asks the operator to paste a command as the normal path.

### 5. Live Build Room

After launch, the run opens into a conjoined workspace: session list on the left,
selected run detail in the center, supporting files/receipts/attention on the
right or in tabs depending on width.

The first selected run is the one just launched. The transcript stream is above
the fold. Files and controls are visible without scrolling past unrelated
metrics.

### 6. Proof Of Work

Completion creates a Work Receipt. The receipt is the trust object, not prose
that says "done."

Primary actions:

- `Review receipt`;
- `Open PR`;
- `Resume from checkpoint`;
- `Fork successor`;
- `Archive`.

## Core Panes

### Session List

The session list is the operator's map of active and recent work. It stays
conjoined with the detail pane so a click immediately changes what the operator
can inspect.

Group rows by:

- live and launchable;
- waiting for operator;
- blocked or non-compliant;
- stale;
- recent history;
- completed with receipt.

Each row shows:

- human title and current goal;
- trusted-agent readiness or non-compliant reason;
- provider/body, model tier, and expanded exact model;
- worktree, branch, and repo freshness;
- live/historical/stale state based on heartbeat or transcript events;
- last activity time;
- unread attention count;
- files touched and claim count;
- cost so far;
- context pressure;
- transcript status;
- PR or receipt status when present.

Behavior:

- clicking a row selects the run and retargets all detail panes;
- double-clicking opens the run room in a focused layout;
- stale rows never appear as live because a stale session row exists;
- non-compliant rows remain visible but controls are gated to attach, inspect,
  fix setup, fork successor where safe, or retire.

### Live Transcript

The transcript is the primary artifact for both live and historical runs.

Render:

- operator and agent messages;
- streaming deltas;
- tool calls with expandable arguments and results;
- shell commands with stdout, stderr, exit code, and duration;
- file reads, writes, diffs, and artifact rows;
- safety stops, approvals, denials, and interrupt acknowledgements;
- PR events and review comments;
- skills/rules attached before launch;
- compaction packets and retained context summaries;
- memory retrievals with citation status;
- errors, retries, checkpoints, and successor links.

Controls:

- `Send message` steers the active run.
- `Interrupt` sends a control command and waits for an acknowledgement event.
- `Approve` and `Deny` act on pending tool gates.
- `Search` filters the selected transcript.
- `Jump to latest` follows live work without losing manual scroll position.
- `Copy event link` creates a durable reference for reviews and receipts.
- `Open source` jumps to file, blob, PR, or log where available.

State rules:

- active runs show live stream, heartbeat, pending gates, context pressure, cost,
  and enabled controls;
- historical runs show replay, final status, time span, predecessor/successor
  links, and disabled controls except search, open artifacts, fork successor, and
  resume from checkpoint;
- missing transcript shows exact cause and remediation, not an empty stream;
- redactions are explicit and explain whether local raw source is available.

### Files And Claims

The files pane makes work concrete.

Show:

- touched files grouped by created, modified, deleted, read-only, and generated;
- absolute path resolved by the daemon plus repo-relative display;
- worktree, branch, and dirty/staged state;
- symbol or region claims where known;
- semantic conflict warnings and file heat;
- inline diff preview;
- syntax-highlighted file preview;
- artifact rows for screenshots, GIFs, recordings, logs, and generated reports;
- open-in-editor and reveal-in-Finder actions.

Click-first actions:

- `Open file`;
- `Preview diff`;
- `Open in editor`;
- `Ask agent about this file`;
- `Split ownership`;
- `Resolve conflict`;
- `Revert candidate change`.

`Revert candidate change` never performs a destructive reset silently. It opens a
preview, explains the checkpoint or patch source, creates a receipt event, and
requires confirmation when the action could discard work from another agent or
the operator.

### Receipts

The receipt pane is available during the run as a growing draft and becomes final
when the run seals.

The receipt contains:

- work brief and launch plan;
- participating agents, providers, models, skills, and rules;
- transcript replay link and selected evidence excerpts;
- files changed, claims, conflicts, and final diffs;
- commands, tests, and outputs;
- approvals, denials, safety stops, interrupts, and rollbacks;
- PR number, checks, comments, and merge state when present;
- cost accrual and budget outcome;
- context compaction and memory-citation summary;
- artifacts: screenshots, GIFs, recordings, logs, reports;
- resume point, successor links, and archive policy.

Click-first actions:

- `Publish receipt`;
- `Retract receipt`;
- `Copy proof bundle`;
- `Open PR`;
- `Resume`;
- `Fork successor`;
- `Export for review`.

Receipts should be treated as evidence objects. If the run cannot prove a claim,
the receipt says "not captured" or "target-only" instead of implying success.

## Active-Agent Behavior

An agent is active only when daemon truth proves recent heartbeat or transcript
events. The UI should separate these cases:

| State | Meaning | Enabled controls |
| --- | --- | --- |
| Live official | Transcript or heartbeat is current and compliance supports control. | Message, interrupt, approve/deny, checkpoint, open files, open PR. |
| Waiting for operator | A tool gate, safety stop, budget warning, or question is pending. | Approve, deny, answer, inspect, interrupt. |
| Paused | Run acknowledged pause and is not executing tools. | Resume, fork successor, retire, inspect. |
| Interrupted | Interrupt command was sent and acknowledgement is pending or received. | Watch acknowledgement, escalate to pause/kill if policy permits, fork successor after checkpoint. |
| Historical | Run ended and has replayable evidence. | Search, open artifacts, resume from checkpoint, fork successor. |
| Stale | Heartbeat or stream is overdue. | Attach, mark stale, fork successor, retire, inspect cause. |
| Non-compliant | Backend exists but lacks official-agent requirements. | Fix setup, attach hook, sandbox probe, inspect, retire. |
| Observed only | Port Daddy can watch but cannot safely govern the body. | Inspect and open artifacts; no C2+ controls. |

The detail header always shows provider/body, exact model in details, compliance
level, heartbeat, session id, worktree, branch, sandbox level, cost, context
pressure, and local/cloud data boundary.

## Click-First Interaction Contract

No ordinary operator path should require typing an agent id, session id,
worktree path, or command.

Required click-first interactions:

| Operator intent | Primary control | Expected result |
| --- | --- | --- |
| Start work | `Describe work` | Draft work brief appears. |
| Bind context | `Attach context` | Picker for files, screenshots, PRs, issues, transcripts, memories. |
| Choose team | `Form team` | Agent proposal cards with skills, rules, risk, and readiness. |
| Fix blocked launch | `Fix setup` | Doctor repair path for exact missing capability. |
| Launch | `Launch build room` | Selected run opens with stream, files, controls, and cost. |
| Steer | `Send message` | Operator turn appears in transcript and is sent through the control channel. |
| Stop risky work | `Interrupt` | Control command event appears, then ack/failure appears. |
| Decide a gate | `Approve` or `Deny` | Tool gate result appears in transcript and receipt draft. |
| Inspect change | `Preview diff` | File diff opens for selected run. |
| Handle overlap | `Split ownership` or `Coordinate` | Claims/conflict plan opens with source evidence. |
| Save safe point | `Checkpoint` | Checkpoint event and resume affordance appear. |
| Continue elsewhere | `Fork successor` | New run is seeded from checkpoint and linked to predecessor. |
| Undo candidate work | `Revert candidate change` | Preview and confirmation appear; receipt records outcome. |
| Finish | `Publish receipt` | Evidence bundle is sealed and linked to PR or archive. |

Advanced command equivalents may exist in inspect mode, but they are not the
happy path.

## Rollback And Interruption

Interruption is a first-class run event.

Flow:

1. Operator clicks `Interrupt`.
2. Panel shows the exact target agent/run and the interrupt reason field.
3. Port Daddy emits a control command event.
4. Transcript shows pending acknowledgement.
5. The run responds with acknowledged, failed, timed out, or unsupported.
6. The panel offers next actions based on the result: resume, checkpoint, fork,
   escalate, retire, or fix setup.

Rollback is based on checkpoints, patches, and receipts. It is not a hidden
`git reset`.

Rollback options:

- `Resume from checkpoint` starts from a known event and context envelope.
- `Fork successor` creates a new run with predecessor, brief, files, and receipt
  links.
- `Revert candidate change` previews the patch to remove a selected run's edits.
- `Retire run` marks the agent inactive without deleting evidence.
- `Retract receipt` marks a published receipt superseded and points to the
  replacement.

Safety rules:

- rollback actions must identify which files and events are affected;
- another agent's or operator's edits require warning and confirmation;
- the receipt records who initiated the rollback and what evidence was used;
- non-compliant or observed-only bodies cannot receive controls Port Daddy cannot
  enforce;
- pane failure must not blank transcript, file, receipt, or command truth from
  the rest of the app.

## Proof Artifacts Needed

Every GPUI, console, website, or dashboard PR that changes this surface needs
screenshot, GIF, and short recording evidence. The proof set should cover the
actual daemon-backed flow, not mocked happy-path art alone.

Required state artifacts:

- first-run empty state with `Describe work` primary;
- work brief review with likely files, proof, budget, and setup blockers;
- team proposal with skills attached and launch gates;
- blocked launch with missing transcript or missing control channel;
- live official agent selected from session list;
- live transcript with message, tool call, file artifact row, and safety event;
- files pane with touched files, claims, diff preview, and openable paths;
- waiting-for-operator gate with approve/deny;
- interrupt flow showing command, acknowledgement, and next actions;
- stale agent remediation;
- historical replay;
- Work Receipt draft and sealed receipt;
- relaunch/reconnect proof that visible state rebuilds from daemon truth.

Existing artifact precedents to preserve:

- `core/pd-console/docs/artifacts/gpui/gpui-harness-mux/` proves active-agent
  cards retarget an adjacent detail lane, but its manifest warns fresh visuals
  must be regenerated before PR use.
- `core/pd-console/docs/artifacts/gpui/proof-live-agent-transcript/` proves a
  live Lane can render transcript, tool, steering, and file artifact rows.
- `core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/` proves
  screenshot-backed visual-task evidence can flow through real routes into Lane.

Validation should include:

- focused UI tests or golden fixtures for session list and detail states;
- projection/replay test proving roster, transcript, files, cost, and receipt can
  rebuild from events;
- one end-to-end smoke with a local official Agent Node emitting transcript
  events, receiving an interrupt or denial, and sealing a receipt;
- accessibility pass for keyboard focus, zoom/text scaling, color-plus-word
  status, and minimum 14px body text.

## Acceptance Checklist

- [ ] First screen starts with describing work, not internal taxonomy.
- [ ] Raw backends are visible but cannot launch as official agents until
      transcript, session, worktree/sandbox, controls, cost cap, and resume proof
      are present.
- [ ] Session list and detail pane are conjoined; selecting a run retargets
      transcript, files, controls, receipts, and attention.
- [ ] "Live" means current heartbeat or transcript events, never only a stale row.
- [ ] Active, historical, stale, observed-only, and non-compliant states are
      visually and behaviorally distinct.
- [ ] Transcript renders messages, tool calls, outputs, files, approvals,
      denials, safety stops, checkpoints, compactions, and errors with timestamps.
- [ ] Files pane shows daemon-resolved paths, claims, diff preview, conflict
      warnings, and open-in-editor/reveal actions.
- [ ] Ordinary controls are click-first: launch, steer, interrupt, approve/deny,
      checkpoint, fork, open file, open PR, publish receipt.
- [ ] Rollback actions preview affected files/events and record receipt evidence.
- [ ] Controls are enabled only when compliance and authority support them.
- [ ] Missing transcript or missing control channel produces remediation, not an
      empty pane.
- [ ] Work Receipt contains transcript, files, claims, tests, PR, costs,
      decisions, blocked actions, artifacts, and resume/successor links.
- [ ] Pane failure or stale projection is labeled and cannot authorize commands.
- [ ] Visual PR proof includes screenshots, GIF, and recording for the required
      states, with no placeholder or blank artifacts represented as proof.
- [ ] Keyboard navigation, visible focus, zoom/text scaling, and color-independent
      status labels are covered before the surface is called operator-ready.
