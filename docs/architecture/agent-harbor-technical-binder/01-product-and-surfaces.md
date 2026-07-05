# 01 Product And Surfaces

## The draw

Port Daddy earns its place by doing what ordinary IDEs and coding CLIs do not:
it makes AI work legible, controllable, resumable, cooperative, and accountable.

Claude Code, Codex, Cursor, Zed, VS Code, and terminal agents are excellent at
starting a single conversation or editing a codebase. They are not enough when
the operator has many agents, many providers, many worktrees, many PRs, and many
partially remembered decisions. Port Daddy's draw is the control plane:

- every agent has a durable identity;
- every action has a transcript, timestamp, file scope, and provenance;
- every active agent can be interrupted, guided, resumed, forked, or retired;
- every provider goes through the same Articles of Agreement;
- every worktree, claim, PR, parley, budget, and memory is visible in one place;
- long-lived infrastructure agents keep the harbor organized while task agents
  do focused work.

That is why the product should not compete only as "the editor with the nicest
completion." It should compete as "the place where AI work becomes governable."

## Surface hierarchy

Port Daddy should have several surfaces, but only one authority model.

Current surface truth:

| Surface | Status | Job |
| --- | --- | --- |
| `core/pd-console` | primary GPUI operator app | Agent roster, live transcript, controls, files, diffs, memory, PRs, blackboard, doctor. |
| FleetBar | compact macOS status and launcher | Health, quick actions, urgent attention, credentials, pause/kill, open Harbor app. |
| Fleet Control Center at `localhost:9876` | daemon-served web control plane | Browser-accessible daemon UI, account/download bridges, diagnostics, fallback control. |
| `pd` CLI | automation and emergency surface | Setup, doctor, probes, scripts, CI, agent-readable commands, deep debugging. |
| TUI / terminal console | fallback or legacy if retained | Read-only or reduced control where GPUI is unavailable; not the primary operator promise. |
| VS Code/editor plugins | in-editor overlays | Claims, conflicts, transcript peek, file heat, approve/deny, open in Harbor. |
| Mobile | observer and commander | Alerts, approvals, transcript reading, pause/interrupt, PR review, device pairing. |

Primary surface: native Harbor app / `pd-console`.
  This is the operator's command room. It shows active and historical agents,
  transcript streams, files, diffs, PRs, memory, claims, parleys, budgets,
  approvals, and controls. It must be beautiful enough to invite daily use and
  dense enough to replace ad hoc terminal juggling.

Secondary surface: `pd` CLI.
  The CLI remains first-class for agents, scripts, CI, debugging, automation,
  and emergency use. The CLI should expose every daemon capability, but routine
  human operation should not require memorizing commands. The CLI is the
  protocol scalpel, not the whole cockpit.

Ambient surface: FleetBar.
  FleetBar is the menu-bar heartbeat: daemon health, active fleet count, urgent
  inbox, cost warnings, credential status, pause/kill, and quick open into the
  Harbor app. It is not where the operator should debug a complex agent run.

Web surface: `portdaddy.dev`.
  The website cannot be only marketing. It must support account creation,
  downloads, signed app releases, device pairing, billing, team harbors, hosted
  relay, documentation, privacy/export/delete controls, and onboarding. The
  marketing site should show the actual operator surface with real screenshots,
  streams, transcripts, and app flows.

Mobile surface.
  Mobile is observer and commander, not full IDE first. It should let the user
  approve, interrupt, pause, nudge, read transcript summaries, inspect diffs,
  respond to PR comments, receive alerts, and pair devices. It should not make
  ambient screen/audio capture or cloud transcript sync implicit. Local agent
  transcripts are still saved by default; the phone is a remote bridge to the
  local or hosted harbor.

Editor plugins.
  VS Code should be the first editor plugin because of reach. JetBrains, Zed,
  Cursor, and other editors can follow. The plugin should not reimplement Port
  Daddy. It should be a thin client over the local daemon:
  claims in the gutter, active agents in a side panel, transcript snippets,
  parley prompts, file heat, conflict predictions, and "open this agent in
  Harbor." For editors with chat APIs, the plugin can route an agent body
  through Port Daddy, but the daemon remains the ledger and guard.

## What the native app must show

The current blank or weak "active agent" view is not enough. The Harbor app needs
conjoined panes:

- a left roster of active and recent Agent Nodes with name, role, provider,
  model tier, local/cloud/fleet marker, last activity time, compliance level,
  cost, status, and attention badge;
- a detail pane for the selected node with live stream, saved transcript,
  controls, files, diffs, claims, notes, memory, PR links, worktree, provider,
  model tier, token/context pressure, and remediation;
- a file tree and worktree view that can open actual files by global path with
  syntax highlighting and symbol/claim overlays;
- a control strip with click actions, not numeric command prompts;
- a transcript renderer mature enough for LLM chat: user/operator messages,
  assistant deltas, tool calls, command output, diffs, errors, approvals,
  citations, and hidden/private event classes clearly marked;
- a mode marker for active stream versus historical replay.

The operator should never need to ask "what files were made?" or "where is the
live transcript?" Those are primary facts of an Agent Node.

## Why still offer a CLI?

The CLI is essential because:

- agents and CI can call it without GUI automation;
- scripts need stable commands for setup, doctor, probes, and remediation;
- power users need a transparent protocol surface;
- local-only users may not want the native app open;
- plugins and hosted agents can shell out or call equivalent APIs.

The default human install should still be one beautiful command:

```bash
pd setup
```

The setup flow should install the signed app, daemon, CLI, hooks, MCP server,
shell completions, and remediation checks. It should report checkmarks, explain
permissions plainly, and route failures to:

```bash
pd doctor
```

No page should present seven sequential manual commands as the happy path.

## First 10 minutes

The first-value path should be concrete:

1. Install the signed app or run `pd setup`.
2. Choose local-only or sign in for relay/device pairing.
3. Connect one provider or import an existing Claude/Codex session.
4. Start or attach one Agent Node.
5. See the roster card: provider, model tier, compliance, cost, transcript
   state, and worktree.
6. Click the agent and watch live transcript events or see why none exist.
7. Open files touched by the agent.
8. Interrupt or steer the agent.
9. Run `pd doctor` from the app if a hook, MCP, or transcript source is missing.
10. Produce a Work Receipt for the run.

Persona wedges:

- solo developer: "I can see and resume what my agents did yesterday."
- team lead: "I can audit every agent PR and prevent overlapping work."
- enterprise buyer: "I can allow AI coding with receipts, retention, secrets,
  and policy instead of informal chat logs."

## Why offer editor plugins?

The operator may not abandon their editor immediately. A plugin meets them where
they already work while still making Port Daddy the system of record.

The plugin should provide:

- "Port Daddy: current file claims" gutter bands;
- "agents touching this symbol" hover;
- "ask Harbor Staff to review this region";
- "send current selection to an Agent Node";
- "open transcript for the agent editing this file";
- "join or create a parley for this conflict";
- "approve or deny a tool action";
- "show semantic conflict risk before commit";
- "open in Harbor app."

The plugin must not store its own independent agent state. It should connect to
the local daemon or a paired remote harbor and render daemon truth.

## Mobile experience

Mobile should be optimized for interruption, not editing. A good mobile session:

1. A Longshoreman notices a Voyager is blocked on a PR comment.
2. The phone shows a concise alert with agent, repo, risk, cost, and options.
3. The user taps the alert and sees transcript context, diff summary, and the
   proposed next action.
4. The user approves, edits the instruction, or pauses the agent.
5. The action is recorded in the transcript and visible in the native app.

Mobile controls should be capability-scoped:

- always allowed: read allowed transcripts, pause, approve low-risk suggestions,
  send a note, mark attention;
- gated by policy: run tests, push branch, reply to GitHub, spend money;
- normally blocked without desktop or stronger auth: destructive filesystem
  changes, secret changes, deploys, deletion, broad memory export.

## Surface capability matrix

| Capability | GPUI app | CLI | FleetBar | Web control | Mobile | Editor plugin |
| --- | --- | --- | --- | --- | --- | --- |
| Observe agents | yes | yes | summary | yes | yes | current repo |
| Spawn local agent | yes | yes | quick action | yes | limited | from selection |
| Attach/import session | yes | yes | no | yes | no | current editor |
| Steer/interrupt | yes | yes | pause/kill | yes | yes, scoped | yes, scoped |
| Approve tool action | yes | yes | urgent only | yes | yes, scoped | yes |
| Edit files directly | later Harbor Editor | script/tool only | no | no | no | editor-native |
| Push/deploy | approval flow | approval flow | no | approval flow | high-auth only | no direct |
| Manage secrets | yes | yes | deep link | yes | view/revoke only | no |
| Billing/account | open web | limited | open web | yes | yes | no |
| Export/delete data | yes | yes | no | yes | limited | no |

All write actions route through daemon command envelopes and produce transcript
or audit events. Surfaces differ in affordance, not authority.

## Competitive posture

Port Daddy does not need to beat every IDE at every edit primitive. It should
beat them at:

- multi-agent visibility;
- cross-provider orchestration;
- transcript and memory continuity;
- operator control and safety;
- cooperative worktree/file/symbol governance;
- local-first privacy with optional cloud reach;
- long-lived staff agents that make coding sessions coherent across days.

The Harbor Editor still matters because a native cooperative editor lets humans
and agents become peers in the same buffer. But the wedge is governed
collaboration, not simply text editing.

## Product promise

An operator should be able to say:

"I can see every agent working for me, understand what it is doing, interrupt it,
resume it, trace what it changed, search how it solved old problems, and let it
coordinate with other agents without losing control."

If a surface does not advance that promise, it is secondary.
