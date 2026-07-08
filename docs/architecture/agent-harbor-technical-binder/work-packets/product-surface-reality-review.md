# Product Surface Reality Review

Status: active work packet for Agent Harbor product reality.

## Mission

Review Agent Harbor and `pd-console` as a product a developer would choose
instead of using raw Claude Code, Codex, Cursor chat, or a pile of terminal
sessions.

This is not a design inspiration memo. It is a product reality gate: what must
be true across GUI, CLI, SDK, MCP, editor, mobile, account, pricing, trust, and
support surfaces before implementation agents build more UI or launch paths.

## Executive Verdict

Agent Harbor is a credible product only if it becomes the system of record and
control layer for agent work.

Raw Claude Code and Codex already win on instant value: open a terminal, type an
instruction, watch a transcript, get a diff. Port Daddy cannot beat them by
being another chat window or another launcher. It wins when it adds the missing
product guarantees:

- one visible Agent Node that joins body, provider, model tier, worktree,
  transcript, files touched, cost, compliance, controls, and receipt;
- local-first transcript and Work Receipt truth that survives daemon restart;
- honest launch readiness: no provider, hook, MCP, transcript, or control path
  means no fake "running" state;
- click-first operator control in `pd-console`, with CLI, SDK, MCP, editor, web,
  FleetBar, and mobile as clients of the same daemon authority;
- cost, privacy, retention, and provider responsibility shown before work runs.

The current binder has the right product spine. The main risk is surface drift:
existing public and internal surfaces still explain fleets, Flow, YAML,
resources, and coordination more clearly than they explain the one first-value
promise: "start or attach one coding agent, watch what it does, control it, and
receive proof."

## Reality Test

The product is real when a skeptical developer can do this without raw
Claude/Codex archaeology:

1. Install or open Port Daddy.
2. Choose local-only or sign in for optional relay/device/account features.
3. Connect or detect one provider body: Codex, Claude Code, local model, or an
   imported unmanaged session.
4. Start or attach one Agent Node from a plain-language work intent.
5. See the live or historical transcript, exact files, provider/model tier,
   cost, compliance state, and control availability.
6. Interrupt, steer, or learn why a control is disabled.
7. Seal a Work Receipt with transcript hash, diff hash, cost, denials, tests,
   PR state, and resume point.

If the user still needs to open raw Claude Code or Codex to answer "what did it
do?", "what files changed?", "can I stop it?", or "can I trust this result?",
Agent Harbor has not crossed the replacement threshold.

## Cross-LLM Adapter Contract

Agent Harbor must treat Claude Code as one provider body, not as the product
shape. The core object is `AgentNode`; the replaceable part is the body adapter
that can launch, attach, observe, control, and persist evidence for a specific
tool or model runtime.

Provider bodies should be described by capability, not brand:

| Adapter capability | Required fields | Examples |
| --- | --- | --- |
| `managed-local-cli` | executable path, version, auth state, hook pack, worktree root, transcript fidelity, control support | Claude Code, Codex CLI, Gemini CLI, Aider, Cursor/Windsurf CLI bridges |
| `managed-local-server` | endpoint, auth custody, model catalog, tool gateway, transcript stream, shutdown control | Ollama/OpenAI-compatible local server, Port Daddy-owned loop |
| `hosted-provider` | provider id, model id, billing path, upload state, region, retention, budget cap | OpenAI, Anthropic, Google, Groq, Cloudflare Workers AI |
| `custom-sdk-body` | SDK version, event append endpoint, control ack endpoint, capability manifest, receipt signer | internal agents, third-party agents, CI workers |
| `observed-import` | source path or process, import confidence, transcript gaps, disabled controls | pasted transcript, terminal log, unmanaged existing session |
| `fixture` | fixture id, scenario, source label, non-production guard | demo data, regression UI fixture |

The launch proposal must be generated from those fields, not from hard-coded
Claude/Codex branches. It should show:

- provider/body kind, model id or tier, auth custody, billing path, local/cloud
  data boundary, and expected transcript fidelity before launch;
- the control matrix (`pause`, `interrupt`, `steer`, `checkpoint`, `fork`,
  `resume`, `retire`) with enabled/disabled reasons;
- tool authority: direct shell, MCP-mediated, daemon preflight, or observed
  only;
- receipt strength: expected transcript hash, diff/file evidence, validation
  capture, and signature policy;
- fallback ladder when the preferred body is not ready.

The adapter contract is additive. A provider that cannot stream tool results is
still usable, but it lands at T1/T2 and renders as observed or weak until a
stronger adapter exists. A provider that exposes private reasoning is not more
official by default; official status comes from persisted visible events,
governed tool results, hash chains, controls, and receipts.

Hard rule:
  The UI may name brands in labels, but the daemon contract must never require
  a Claude-shaped transcript, hook, model id, or control protocol as the only
  path to official work.

## Single-Agent Run Rendering

The first great Agent Harbor screen is not a fleet map. It is one run rendered
so well that a developer trusts it more than the raw tool transcript.

Render a single `AgentRun` as five locked panes over one daemon event chain:

1. **Run header**
   - Work intent, status, provider body, model tier, worktree, branch/base,
     spend cap, elapsed time, fidelity level, receipt state, and privacy mode.
   - No "LIVE" badge unless a recent heartbeat or transcript/control event
     proves liveness.
2. **Transcript timeline**
   - Chronological operator messages, assistant messages, reasoning summaries
     when available, tool calls, tool results, control events, denials,
     approvals, cost warnings, checkpoints, errors, and stop reason.
   - Tool calls render as compact rows with status, duration, exit code, files
     touched, and a one-step zoom to stdout/stderr/blob/diff evidence.
   - Provider narration is labeled as narration; the canonical proof is the
     persisted artifact, command result, diff, or receipt hash.
3. **Work ledger**
   - Files read, files changed, claims, commands, MCP/tool calls, approvals,
     denials, and validation artifacts grouped by reviewer task, each linking
     back to the timeline event that produced it.
4. **Control rail**
   - Pause, interrupt, steer, checkpoint, fork, resume, retire, approve, deny,
     and publish receipt.
   - Disabled controls stay visible with exact daemon reasons: observed body,
     unsupported adapter, no active session, missing hook, stale heartbeat,
     policy block, or receipt already sealed.
5. **Receipt and proof drawer**
   - Work Receipt summary, risk to check first, validation evidence, transcript
     head hash, diff/file hashes, cost summary, visual-evidence manifests, PR
     links, replay command, and verification status.

Default view:
  Open on the transcript timeline plus run header. The work ledger and proof
  drawer are visible as tabs or side panels, not hidden in a separate product.

Digest-with-zoom rule:
  Summary cards may rank what matters, but every number, badge, and claim must
  zoom to the exact event, blob, command output, diff, manifest, or receipt row
  that produced it in at most two steps.

Empty and degraded states are first-class:

| State | Render as | Primary action |
| --- | --- | --- |
| T0 registered only | `registered, no transcript` | Open Doctor or attach as observed |
| T1 run log | `run log` with structured steps only | Upgrade adapter or inspect step metadata |
| T2 chat only | `chat transcript` with weak coding proof | Install tool hooks / route tools through gateway |
| T3 tool-backed | `tool-backed transcript` | Generate weak/strong receipt depending on hashes |
| T4 verified | `verified transcript` | Publish receipt or continue/fork |
| T5 resumable | `resumable transcript` | Fork successor, replay, or rollback |
| observed import | `observed` | Relaunch through Work Intent for managed controls |
| fixture/mock | `fixture` or `mock` | Use for UI/testing only, never production proof |

Visual evidence for this screen must carry manifests that bind screenshots or
recordings to daemon port, run id, transcript head hash, agent node id, commit,
and honest source label. Fixture screenshots are fine when labeled; unlabeled
"live-looking" screenshots are not proof.

## Surface Responsibilities

All surfaces must render daemon truth. They may differ in density and
affordance; they must not keep separate runtime state.

| Surface | Product job | Replacement threshold | Must not do |
| --- | --- | --- | --- |
| `pd-console` / native Harbor app | Primary human command room for active and historical Agent Nodes. | User can launch or attach one body, watch transcript, inspect files, steer, interrupt, and seal a receipt without numeric ids. | Show decorative rosters, "live" badges, or enabled controls that the daemon cannot enforce. |
| FleetBar | Ambient health, launcher, attention, credential and pause signals. | User can see "safe to launch?", credential gaps, running count, urgent gates, and open the exact Agent Node. | Become the deep debugger or hide missing setup behind a green menu-bar icon. |
| Fleet Control Center / web at localhost | Browser fallback, account bridge, diagnostics, downloads, pairing, support workflows. | Browser can repair setup, show the same daemon state, and bridge to account/billing/pairing without becoming a separate control plane. | Diverge from `pd-console` truth or present cloud/account as required for local use. |
| CLI | Agent/script/CI/emergency surface. | Every daemon capability has a stable command or machine-readable equivalent; `pd setup` and `pd doctor` are the human-safe defaults. | Make the happy path a wall of commands or require users to type ids for routine inspection. |
| SDK | Integrator contract for custom agents, tools, and surfaces. | A third-party or internal body can register, stream events, request tool preflight, receive controls, and emit receipts without reverse-engineering daemon routes. | Be a thin helper around unstable private APIs. |
| MCP | Model-client bridge and permission broker. | Claude/Codex/MCP-aware agents can discover Port Daddy primitives, request capabilities, append evidence, and get scoped context through explicit tool descriptions. | Let MCP servers bypass daemon policy or pretend install/discovery is safe without manifests and smoke tests. |
| VS Code / editor plugins | Thin in-editor overlay. | Current file shows claims, active agents touching it, transcript peek, approval prompts, and "open in Harbor." | Store independent agent state or make the editor the ledger. |
| Mobile | Observer and commander. | User can receive an alert, read context, approve/pause/interrupt scoped actions, and see that the action was recorded. | Become a full remote IDE first, or allow high-risk writes without stronger auth and policy. |
| Public website | Acquisition, download, account, docs, trust, and proof. | Visitor understands the first value and sees real screenshots/artifacts from the current product. | Market cloud/fleet/marketplace promises ahead of local Agent Node proof. |

## CLI Versus GUI

The CLI remains essential, but it cannot be the product's primary human
experience.

The GUI must own:

- selecting active and historical Agent Nodes;
- live stream and saved transcript rendering;
- file and diff inspection;
- setup repair cards;
- provider/account/secret readiness;
- controls and approval gates;
- Work Receipt inspection and sharing.

The CLI must own:

- setup, doctor, probes, scripting, CI, and emergency control;
- JSON output for automation;
- exact route to reproduce GUI repair decisions;
- deep debugging when the GUI says a thing is broken.

Required alignment:

- every GUI button maps to a command, query, event, or explicit unsupported
  state from F0;
- every CLI launch or attach path produces the same Agent Node projection as the
  GUI;
- no UI can call something "managed", "compliant", "live", or "stopped" unless
  the daemon can prove that state.

## SDK And MCP Developer Surface

Agent Harbor needs both, but they serve different customers.

SDK customers:

- custom local agents;
- cloud worker bodies;
- IDE and app integrations;
- scripts that need durable event append, capability preflight, and receipts.

Minimum SDK contract:

- register or attach body;
- declare body/provider/model tier and authority;
- append transcript/tool/file/cost/control events;
- request pre-tool approval or denial;
- receive pause/interrupt/steer/checkpoint/successor commands;
- seal or verify Work Receipt;
- read readiness/remediation state.

MCP customers:

- Codex/Claude/MCP-aware model clients;
- agents that need Port Daddy coordination primitives from inside their tool
  palette;
- MCP server installers and permission reviewers.

Minimum MCP contract:

- tool descriptions must expose authority and side effects plainly;
- every write tool must route through daemon policy;
- MCP installation needs manifest, provenance, permission label, health check,
  disable/repair/uninstall, and usage trace;
- MCP failures become transcript/support events, not invisible stderr.

Do not build an SDK or MCP catalog as a separate product before the first local
Agent Node event contract exists. Without F0/C1 truth, SDK and MCP clients will
freeze the wrong shape.

## Cold Start

Raw Claude/Codex cold start is brutally simple. Agent Harbor must respect that.

Target first 10 minutes:

1. Open signed app or run `pd setup`.
2. Choose local-only or optional sign-in.
3. See daemon/app/CLI/hook/MCP/provider readiness in one checklist.
4. Connect a provider key or detect an existing installed body.
5. If no provider is ready, choose a labeled fallback: dry-run probe, import an
   observed session, or local model if configured.
6. Launch or attach one Agent Node.
7. Watch transcript or see the exact no-transcript reason.
8. Open files touched.
9. Press one real control or see why controls are disabled.
10. Generate a Work Receipt.

Cold-start failure states are product features, not edge cases:

- no account: local mode still works;
- no provider key: Keychain card explains BYOK, local model, observed import,
  and dry-run probe options;
- stale daemon: app says which install is running and offers safe restart;
- missing hook or MCP config: doctor card names the hook/tool and retests;
- transcript path unwritable: block managed launch or downgrade honestly;
- unsupported body: import as observed/unmanaged with disabled controls;
- cost cap zero: launch blocked with budget explanation and local fallback;
- cloud unavailable: local mode remains usable.

## Accounts, Secrets, And Provider Fallback

Account model:

- local-only must not require an account;
- optional account unlocks signed downloads/update identity, relay, mobile
  pairing, push notifications, encrypted sync, billing, teams, and hosted
  agents;
- account sign-in should appear during onboarding as useful, not mandatory.

Secrets:

- provider keys live in Keychain or platform keyring by default;
- UI shows storage location, scope, last used time, allowed agents, whether the
  key can leave the machine, and revoke action;
- no `.env.local` happy path for routine users;
- no transcript event may print a secret payload;
- remote sessions require explicit secret grant.

Provider fallback ladder:

1. Preferred managed local body with transcript/control hooks.
2. Managed local body with partial compliance and clear disabled controls.
3. BYOK remote or hosted body with explicit cost, authority, and upload state.
4. Local model with lower capability but clear privacy/cost posture.
5. Observed/imported session with no compliance overclaim.
6. Dry-run probe or sample fixture clearly labeled as non-production.

Never silently swap a local run for hosted spend. Never silently swap a managed
run for observed mode. The product can degrade, but it has to say so.

## Pricing And Trust

Pricing has to answer four questions before a user launches work:

1. What do I pay Port Daddy for?
2. What do I pay model providers for?
3. What can spend money during this run?
4. What happens when a cap is reached?

Recommended packaging logic:

- Local-only: usable without account; user pays provider directly through BYOK
  or local models.
- Pro/local-plus: subscription for signed app/update channel, relay, mobile
  pairing, notification bridge, support bundle, and optional encrypted sync.
- Hosted agents: explicit compute/orchestration/storage/provider pass-through
  with per-run budget and hard cap.
- Team harbor: seats, shared policy, retention, audit, cloud storage, and admin
  controls.

Trust copy must stay concrete:

- "Local transcripts stay local unless you opt into sync."
- "This run can spend up to $X."
- "This key is stored in Keychain and can be used by these agents."
- "This action is blocked because the body is observed, not managed."
- "This receipt verifies transcript and diff hashes after restart."

Do not lead with "trust economy", marketplace, public harbor, or agent
certification until local receipt/proof exists. Trust is not a brand voice. It
is a visible chain of evidence.

## Support Surface

Support is part of the product because this is infrastructure on a developer's
machine.

Minimum support surfaces:

- `pd doctor` and GUI Doctor share the same checks;
- one-click redacted diagnostic bundle;
- visible versions: app, daemon, CLI, MCP config, hooks, provider adapter;
- "copy support packet" with no secrets and with transcript/hash references;
- crash report location and opt-in upload;
- data export/delete/redact flows;
- known issue cards for stale daemon, missing provider, disabled hook, broken
  MCP, unwritable transcript path, and blocked cost cap;
- support tier copy that distinguishes local-only, Pro sync, hosted, and team
  responsibilities.

Support should never say "run these ten shell commands" as the first move. It
may offer the exact command as the agent/script path after the app explains the
state and safe repair.

## First Value

The first value is not "run a fleet." It is:

> I can see and control one AI coding run better than I can in the raw tool.

The first demo should be one of:

- attach a current Codex or Claude Code session and show what Port Daddy can and
  cannot observe;
- launch one managed local body from a work intent and show live transcript,
  files, controls, and receipt;
- import yesterday's unmanaged session and honestly show observed mode with a
  remediation path to managed mode.

Do not make Shipwright, fleet YAML, Flow topology, marketplace, mobile, or
cloud billing the first value. They matter after the user trusts one Agent Node.

## Current Website Reality Finding

`website-v2/src/pages/AgentsPage.tsx` currently does a stronger job explaining
fleet coordination than Agent Harbor replacement value.

It explains:

- `pd-fleet.yml`;
- Shipwright;
- Flow;
- actors versus bodies;
- daemon runtime;
- Coordination Guard;
- resources and launch readiness;
- salvage and communication primitives.

It does not yet give a crisp public first-run story for:

- "use this instead of raw Claude Code or Codex";
- one Agent Node from intent to receipt;
- provider/secrets readiness and fallback;
- pricing, account, local-only, and cloud trust boundaries;
- support when hooks, daemon, MCP, or transcript capture fail.

Recommendation:
  Do not rewrite the public page ahead of proof. Add/adjust public copy only
  after the first local Agent Node proof exists, and then lead with the actual
  app flow, not fleet taxonomy.

## Must Fix Before Build

These are blockers for the first implementation wave. If ignored, the result
will look like a product while behaving like scattered launch plumbing.

### P0. Freeze The Agent Node Contract

Before more GUI work, F0 must define the command/query/event boundary for
`WorkIntent`, `WorkPlan`, `AgentNode`, `AgentRun`, `TranscriptEvent`,
`ControlCommand`, `ComplianceProbeResult`, `CostAccrualEvent`, `ContextEnvelope`,
`SkillGraft`, and `WorkReceipt`.

Proof:
  Every user-visible control maps to daemon authority or an explicit unsupported
  state.

### P0. Make The Body Adapter Contract Cross-LLM

Define provider bodies by capabilities and fidelity levels, not by Claude Code
assumptions. The first implementation may support one or two bodies, but the
schema must already fit Codex, Claude Code, Gemini, Aider, Cursor/Windsurf,
local servers, hosted providers, SDK agents, observed imports, and fixtures.

Proof:
  A fixture matrix renders launch proposals and run details for managed local,
  hosted, SDK, observed, and fixture bodies without code paths that special-case
  Claude as the only official shape.

### P0. Prove One Local Managed Body

Pick Codex or Claude Code first. Show one local body registering, emitting or
attaching transcript events, reporting files touched, and surviving daemon
restart as an Agent Node.

Proof:
  `pd-console` can show active and historical state from daemon truth, not cached
  UI state.

### P0. Make Transcript Absence Explicit

No blank pane. No fake transcript. Missing transcript must render as a state
with reason, compliance downgrade, and repair path.

Proof:
  Fixtures for managed transcript, observed/no transcript, broken hook, and
  unwritable path render distinct states.

### P0. Ship The Single-Agent Run View Before Fleet Views

The run view is the product's trust proof. It must render header, transcript
timeline, work ledger, control rail, and receipt/proof drawer from persisted
daemon events.

Proof:
  A skeptical reviewer can answer what changed, why, which tools ran, what
  evidence exists, what controls are enforceable, and what risk to inspect
  first without opening the raw provider app.

### P0. Gate Controls By Real Authority

Pause, interrupt, steer, checkpoint, successor, retire, approve, deny, and
receipt publish must be enabled only when the daemon can enforce or witness the
action.

Proof:
  A destructive git fixture is blocked before side effects, denial appears in
  transcript and receipt, and observed bodies cannot receive managed controls.

### P0. Build Setup And Doctor As First-Class Product

Install, app launch, daemon, hooks, MCP, transcript path, Keychain, provider
keys, worktree root, relay pairing, and stale version checks need one readiness
surface.

Proof:
  Broken hook, disabled MCP, missing key, stale daemon, and unwritable transcript
  fixtures produce repair cards and retest.

### P0. Define Provider And Secret Fallback

Before launch UI ships, decide the fallback ladder and copy for no key, weak
adapter, observed import, local model, hosted body, cost cap, and cloud outage.

Proof:
  Launch proposal shows provider, model tier, billing path, key storage, upload
  state, and exact fallback or block reason.

### P0. Seal A Verifiable Work Receipt

The receipt is the trust object. It must not be a pretty summary generated from
the UI.

Proof:
  Receipt verifies transcript hash, diff hash, cost events, denials, tests, PR
  links, and resume point after daemon restart.

### P1. Publish A Developer Contract For Custom Bodies

SDK and MCP shapes must be derived from F0/C1/C2, not invented by adapters.

Proof:
  Minimal stdio or HTTP custom body can register, stream, request preflight,
  complete, and emit a partial or full receipt.

### P1. Write Pricing And Trust Copy Before Public Cloud Claims

No public harbor, hosted agent, mobile sync, team, or marketplace copy should
ship without cost, retention, provider billing, local-only, sync, and delete
boundaries.

Proof:
  One pricing/trust matrix distinguishes Local-only, Pro sync, Hosted agent, and
  Team harbor.

### P1. Build Support Packet And Diagnostics

Support must be productized before broader adoption. Agent Harbor will fail in
messy local environments.

Proof:
  GUI and CLI can produce the same redacted diagnostic bundle and name current
  app/daemon/CLI/hook/MCP/provider versions.

### P2. Defer VS Code And Mobile Until Agent Node Truth Exists

Editor and mobile are important clients, but they should not stabilize the wrong
contract.

Proof:
  Their first specs explicitly say thin client over daemon truth, no independent
  ledger, and no high-risk action without scoped capability.

## Build Recommendation

Build in this order:

1. F0 contract freeze.
2. Cross-LLM body adapter contract.
3. One local managed Agent Node proof.
4. Single-agent run view with digest-with-zoom.
5. Transcript absence and compliance downgrade states.
6. Setup/Doctor readiness and provider fallback.
7. `pd-console` roster/detail for active plus historical runs.
8. Work Receipt verification.
9. SDK/MCP minimal custom-body contract.
10. Public website first-run story backed by the proof.
11. VS Code, mobile, cloud, teams, marketplace, and richer Fleet/Shipwright
   narratives.

The product should earn the right to talk about fleets by first making one
agent undeniable.

## Decision Requests

These need an explicit owner decision before implementation agents lock in UX or
API assumptions:

1. First supported managed body: Codex first, Claude Code first, or both with a
   lower shared compliance bar?
2. Product naming: is the operator app called Harbor while the crate remains
   `pd-console`, or is `pd-console` still the product-facing name?
3. Local-only packaging: free, paid local license, or account-optional Pro with
   local free core?
4. Provider billing: BYOK-first only, hosted pass-through, or both in the first
   public story?
5. Default retention: keep local transcripts until manual delete, N-day default,
   or project policy default?
6. Support boundary: what does a local-only user receive versus a Pro/hosted
   user when setup breaks?

## Acceptance Gate For This Review

This review is satisfied when the next implementation packet can answer, in one
sentence per surface:

- what truth the surface reads;
- what action it can safely perform;
- what fallback it shows when truth is missing;
- what proof makes the claim non-Potemkin.

If a surface cannot answer those four questions, it is not ready to build.
