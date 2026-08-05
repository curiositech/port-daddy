# First-class agent sessions

A Port Daddy session is the durable object that joins intent, lineage, runtime
evidence, transcript, events, artifacts, permissions, worktree, accounting, and
recovery. It is not a process row and it is not a second launcher.

This is the product contract for FleetBar, Fleet Control Center, Beacon,
pd-console, CLI, MCP, SDK, and future remote surfaces. The mechanical lifecycle
stays in [spawn lifecycle](../operations/spawn-lifecycle.md).

## Current product baseline

Coding-agent products now make session identity and continuity visible rather
than treating an agent as a disposable terminal process:

- GitHub's agents panel exposes live session logs, progress, token usage,
  duration, steering, stop/archive/share, history queries, and commit-to-session
  traceability. Its desktop app can isolate sessions in worktrees or cloud
  sandboxes. Sources: [managing agent sessions](https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents),
  [Copilot app sessions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions),
  and [cloud and local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes).
- Claude Code exposes print mode, continue/resume by ID, explicit turn limits,
  permission modes, allowed/disallowed tools, and MCP configuration. Source:
  [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage).
- Cursor exposes asynchronous remote agents, status and follow-ups, isolated
  machines, chat history, resumption, MCP tools, command approval, memories,
  and web/mobile-to-desktop handoff. Sources:
  [background agents](https://docs.cursor.com/background-agent),
  [history](https://docs.cursor.com/en/agent/chat/history),
  [Cursor CLI](https://docs.cursor.com/en/cli/using),
  [memories](https://docs.cursor.com/en/context/memories), and
  [web and mobile](https://docs.cursor.com/en/background-agent/web-and-mobile).
- OpenAI's desktop Codex surface is a command center for parallel, long-horizon
  work with isolated worktrees, progress, decisions, diffs, skills, automations,
  workspace controls, plugins, and remote access to supported desktop tasks.
  Sources: [Codex app release](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-edu-release-notes),
  [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex),
  and [plugins in Codex](https://help.openai.com/en/articles/20001256-plugins-in-codex/).

Port Daddy's advantage is one honest session ledger across those harnesses,
machines, worktrees, providers, and operator surfaces.

## Capability matrix

| Priority | Capability | Required session truth | Primary surface |
|---|---|---|---|
| P0 | Identity | Stable session, receipt, semantic agent, and provider IDs | Roster and header |
| P0 | Lineage | Immutable predecessor, successor, and continuation reason | Header and lineage rail |
| P0 | Liveness | Exact state, evidence source, freshness time, PID/provider observation | Roster and header |
| P0 | Transcript | Prompts, responses, tools, progress, approvals, errors, event cursor | Timeline |
| P0 | Location | Repository, worktree, branch, workdir, host, selected daemon endpoint | Header and inspector |
| P0 | Collection | Terminal result, commits, diffs, tests, artifacts, PR, salvage state | Result card |
| P0 | Accounting | Tokens, elapsed time, exact/estimated cost, budget, rate mode | Header and inspector |
| P0 | Controls | Join, steer, approve/deny, interrupt, cancel, continue, archive | Header and composer |
| P1 | Permissions | File, shell, network, secrets, browser, background grants, approval history | Inspector |
| P1 | Sandbox | Local worktree, OS/cloud sandbox, egress policy, snapshot state | Inspector |
| P1 | MCP/connectors/plugins | Installed, enabled, authenticated, unavailable, tool-call history | Inspector |
| P1 | Memory and caches | Rules, skills, recalled context, index and cache freshness | Inspector |
| P1 | Notifications | Attention, approval, completion, stall, budget, degraded daemon | Roster and OS |
| P1 | Keyboard model | Global new/open/search; local steer, cancel, transcript search | Command palette |
| P1 | Browser runtime | Browser/profile, Chromium and extension versions, downloads, logs | Inspector and artifacts |
| P2 | Automations | Trigger, recurrence, owner, next run, pause state | Automation drawer |
| P2 | Collaboration | Viewer/editor authority, share state, handoff, reviewer, actor owner | Inspector and timeline |
| P2 | Remote continuity | Harbor/machine, sync policy, checkpoint, offline state | Roster and inspector |

## One primary desktop window

FleetBar and pd-console use one main window, not a constellation of agent
windows. The transcript is the dominant surface; the inspector is collapsible.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Search · New session · Attention · Daemon/harbor health · Account          │
├──────────────────┬───────────────────────────────────┬──────────────────────┤
│ SESSION ROSTER   │ TRANSCRIPT + ACTIVITY             │ INSPECTOR            │
│ Active           │ Session header and lineage        │ Runtime evidence     │
│ Needs attention  │ Prompt/response/tool/event stream │ Worktree + sandbox   │
│ No runtime       │ Approvals and artifacts inline    │ Permissions          │
│ Terminal         │ Result and collection state       │ MCP/connectors       │
│ Archived         │ Steer/approve composer            │ Cost/cache/memory    │
├──────────────────┴───────────────────────────────────┴──────────────────────┤
│ Current action · keyboard hints · sync and retention provenance            │
└─────────────────────────────────────────────────────────────────────────────┘
```

The header always shows stable identity, plain lifecycle state and evidence
time, lineage, backend/model, worktree/workdir, elapsed time, tokens, cost,
budget, and one evidence-appropriate primary action: `Join session` for a
joinable runtime, `Collect receipt` while admission is unsettled, or `Continue
as successor` when the operator wants a linked handoff.

## Join and Continue

- `Join session` opens the canonical live runtime. It never creates a process.
- `Continue as successor` admits one new receipt-backed successor from an
  active, terminal, or no-runtime predecessor when lineage policy permits it,
  records reciprocal lineage, and opens that successor. On an active row this
  is an explicit handoff, not another spelling of Join: the predecessor is
  sealed only after the successor identities are durably recorded.
- The predecessor transcript and evidence stay immutable.
- Repeating an identical continuation request returns the same receipt.
- A lost client response becomes `unknown` and reconnects to the same receipt;
  it never manufactures another successor.
- A historical filesystem scan may populate clearly labelled archival rows. It
  cannot override live daemon evidence or freshness provenance.

## Beacon projection

Beacon is a projection over Port Daddy's session authority, not another
launcher. After `Continue` is accepted, the modal stays open as a successor
card. Before dismissal it shows:

- canonical successor session, agent, receipt, and transcript IDs;
- the predecessor link and continuation direction;
- `accepted`, `starting`, `live`, terminal, `no_runtime`, or `unknown`, plus
  evidence source, observation time, and heartbeat age;
- exact serving daemon label, endpoint, and source revision;
- workdir, host/harbor, and worktree/branch when known;
- backend/model and granted permissions, sandbox/network/background authority,
  MCP/connectors/plugins, and browser runtime;
- transcript cursor and health, artifacts/result, tokens, cost, budget, and the
  source of accounting evidence;
- one primary `Join successor` action that opens the canonical Control Center
  URL while the receipt is accepted, starting, or live;
- `Open transcript` and `Copy permalink` as secondary actions.

While a successor is live, `Continue as new handoff` may appear as a secondary
action beside the primary Join action; it must explain that it creates a new
linked successor and seals this predecessor only after durable admission. It
becomes the primary action for a terminal or `no_runtime` state. `unknown`
reconnects to the same receipt. If transcript collection is degraded or
stalled, Beacon shows that banner and the last durable cursor instead of
rendering an empty, apparently healthy timeline.

Beacon never substitutes the predecessor ID for the successor, maps a generic
`running` string to proven liveness, invents a worktree, or treats observation
latency as task failure.

## State, activity, and nautical voice

| State | Primary text | Optional secondary copy | Motion |
|---|---|---|---|
| `accepted` | Accepted | Berth reserved | One brief acknowledgement |
| `starting` | Starting | Preparing runtime; “fitting out” may follow | Slow left-to-right shimmer |
| `live` | Live | Exact current activity; nautical verb may follow | Subtle wave or wheel while evidence is fresh |
| `completed` | Completed | Result sealed | None |
| `failed` | Failed | Exact failure reason | None |
| `cancelled` | Cancelled | Actor and reason | None |
| `no_runtime` | No runtime | Session and transcript retained | None |
| `unknown` | Outcome unknown | Reconnecting to receipt | Bounded reconnect pulse |
| `archived` | Archived | Retention/sync provenance | None |

The live line may say `Searching files in spawn-routes.ts`, `Editing
session-flow.ts`, `Running focused conformance tests`, or `Waiting for approval:
network access`. A low-amplitude wave, moving boat, or turning wheel may decorate
that line only while the underlying event is current. It stops when the event
ends, the heartbeat becomes stale, or reduced motion is enabled.

“Circumnavigating,” “consulting sextant,” and “taking soundings” may follow the
exact activity. They never replace state, tool, path, approval, or error text.
International Code of Signals flags keep their real meaning; Port Daddy
associations are explicitly secondary.

## Authority and runtime inspector

Permissions are a ledger, not a one-time modal. The inspector separates
requested from granted authority; session-only from project/account/team policy;
foreground approval from background permission; granting actor, timestamp,
expiry, and revocation; and blocked attempts with the blocking policy.

MCP servers, connectors, and plugins show installation, authentication, health,
tool inventory, last use, and data destination. Secrets remain references to a
keychain or managed store, never transcript text.

The inspector also distinguishes:

- repository index and commit/worktree freshness;
- shared embedding cache readiness;
- package/build caches and worktree reuse;
- provider-reported prompt/context cache accounting;
- rules, skills, recalled memory, provenance, scope, confidence, and staleness;
- local-only versus synced history.

“Context loaded” without provenance is insufficient.

## Browser and Signal-plugin runtime

Browser automation is a versioned runtime attached to the session. Show the
browser engine and exact Chromium build; builder/downloader and checksum;
profile and storage partition; extension/Signal-plugin version and manifest;
sandbox/network policy; downloads, screenshots, recordings, console, network,
and accessibility logs; cache path and retention; background authority; and
native-host/connector signature.

Source compilation is not readiness. The exact Chromium and plugin artifacts
used by the run must be named, checksummed, launch-tested, and linked to proof.

## Keyboard and accessibility contract

| Action | Default |
|---|---|
| New session | `Cmd/Ctrl+N` |
| Open session search | `Cmd/Ctrl+K` |
| Focus attention queue | `Cmd/Ctrl+Shift+A` |
| Search transcript | `Cmd/Ctrl+F` |
| Focus steer composer | `Cmd/Ctrl+L` |
| Interrupt focused live session | `Cmd/Ctrl+.` with confirmation |
| Toggle inspector | `Cmd/Ctrl+Shift+I` |
| Next/previous session | `Cmd/Ctrl+]` / `Cmd/Ctrl+[` |

Shortcuts are discoverable, remappable, and avoid text-editing and assistive
technology conflicts. State uses text, icon/flag, and color. Body text is at
least 14 px and respects OS scaling and browser zoom. Motion conveys no unique
information and obeys reduced-motion settings. Focus order is roster,
transcript, composer, then inspector. Offline mode retains the last durable
cursor and labels freshness.

## Ship gate

Do not ship a continuation surface until the operator can answer, without a
terminal:

1. What stable session and receipt were created?
2. Which predecessor did it continue?
3. Is it accepted, starting, live, terminal, no-runtime, or unknown?
4. What evidence supports that state, and how fresh is it?
5. Where is it working, and on which selected daemon endpoint?
6. Which backend/model, permissions, connectors, sandbox, and browser runtime?
7. Where are transcript, artifacts, usage, cost, budget, and retained result?
8. What single action joins the canonical session?

## Anti-patterns

- A green “active” dot derived from a session row.
- A success toast that creates a successor but does not reveal where it went.
- Multiple competing transcript, agent, attach, and resume buttons.
- A generic wall-clock timeout that cancels healthy CLI work.
- A client that guesses a loopback port.
- Filesystem mtime presented as liveness.
- A resumption action that mutates or obscures predecessor lineage.
- Hidden background permissions or connector authentication.
- Nautical copy that obscures exact state or misuses a signal flag.
- Shimmering rows after activity or heartbeat freshness ends.

## See also

- [Spawn lifecycle](../operations/spawn-lifecycle.md)
- [Daemon and supervision](../operations/daemon-and-supervision.md)
