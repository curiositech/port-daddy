# First-class agent sessions

Port Daddy treats every coding-agent run as a durable, inspectable session. A
session is not a row that happens to point at a process. It is the stable object
that joins intent, lineage, runtime evidence, transcript, events, artifacts,
permissions, worktree, accounting, and recovery.

This document is the product contract for FleetBar, Beacon, pd-console, CLI,
MCP, SDK, and future mobile or remote surfaces.

## Market baseline

Current coding-agent products have converged on a recognizable baseline:

- GitHub exposes an agents panel with live session logs, progress, token usage,
  duration, steering, stop/archive/share, natural-language history queries, and
  commit-to-session traceability. Its desktop agent experience can run each
  session in a separate worktree or cloud sandbox. Sources: [managing agent sessions](https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents),
  [GitHub Copilot app sessions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions),
  and [cloud and local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes).
- Claude Code makes session continuation, resume-by-ID, non-interactive mode,
  explicit turn limits, permission modes, and MCP configuration first-class CLI
  concepts. Source: [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage).
- Cursor exposes background-agent status and follow-ups, isolated remote
  environments, history and resumption, MCP tools, command approval, memories,
  usage, and web/mobile handoff. Sources: [background agents](https://docs.cursor.com/background-agent),
  [history](https://docs.cursor.com/en/agent/chat/history), [Cursor CLI](https://docs.cursor.com/en/cli/using),
  [memories](https://docs.cursor.com/en/context/memories), and [web and mobile agents](https://docs.cursor.com/en/background-agent/web-and-mobile).
- Windsurf gives Cascade conversations their own worktrees, tools, checkpoints,
  terminal, MCP, memories/rules, and keyboard entry points. Sources: [Cascade overview](https://docs.devin.ai/desktop/cascade/cascade),
  [worktrees](https://docs.devin.ai/desktop/cascade/worktrees), and
  [memories and rules](https://docs.devin.ai/desktop/cascade/memories).
- OpenAI's desktop agent surfaces distinguish local and cloud work, allow
  progress review and course correction, and support remote access to selected
  desktop Codex chats. Source: [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex).

Port Daddy's advantage is not another chat shell. It is one honest session
ledger across those harnesses, machines, worktrees, providers, and operator
surfaces.

## Prioritized capability matrix

| Priority | Capability | Required session truth | Primary surface |
|---|---|---|---|
| P0 | Identity | Stable session ID, receipt ID, semantic agent identity, provider identity | Roster and header |
| P0 | Lineage and continuation | Predecessor, successor, reason, immutable original transcript | Header and lineage rail |
| P0 | Lifecycle and liveness | Exact state, evidence source, freshness timestamp, PID or provider observation | Roster and header |
| P0 | Transcript and event stream | Prompts, responses, tools, progress, approvals, errors, event cursor | Center timeline |
| P0 | Location | Repository, worktree ID, branch, absolute workdir, local/cloud/remote host | Header and inspector |
| P0 | Collection | Terminal result, commits, diffs, tests, artifacts, PR, salvage state | Timeline and result card |
| P0 | Accounting | Tokens, elapsed time, exact/estimated cost, budget, rate mode | Header and inspector |
| P0 | Controls | Open, steer, approve/deny, interrupt, cancel, resume, archive | Header and composer |
| P1 | Permissions | File, shell, network, secrets, background grants, approval history | Inspector |
| P1 | Sandbox | Local worktree, OS sandbox, cloud sandbox, egress policy, snapshot state | Inspector |
| P1 | MCP/connectors/plugins | Installed, enabled, authenticated, unavailable, tool-call history | Inspector |
| P1 | Memory and caches | Rules, skills, recalled context, code index, embedding/cache freshness | Inspector |
| P1 | Notifications | Attention requests, approvals, completion, stall, budget, daemon degraded | Roster badges and OS notifications |
| P1 | Keyboard model | Global new/open/search; local steer, stop, transcript search, next attention | Command palette |
| P1 | Browser runtime | Browser session, profile, downloads, extension/connector versions | Inspector and artifacts |
| P2 | Automations | Schedule/trigger, recurrence, owner, next run, pause state | Automation drawer |
| P2 | Collaboration | Viewer/editor rights, share state, handoff, reviewer, actor ownership | Inspector and timeline |
| P2 | Remote continuity | Machine/harbor, sync policy, last durable checkpoint, offline state | Roster and inspector |

## One primary desktop window

FleetBar and pd-console use one main window rather than a constellation of
floating agent windows.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Global search · New session · Attention · Daemon/harbor health · Account   │
├──────────────────┬───────────────────────────────────┬──────────────────────┤
│ SESSION ROSTER   │ TRANSCRIPT + ACTIVITY             │ INSPECTOR            │
│                  │                                   │                      │
│ Active           │ Canonical session header          │ Runtime evidence     │
│ Needs attention  │ Lineage and continuation receipt  │ Worktree + sandbox   │
│ No runtime       │ Prompt/response/tool/event stream  │ Permissions          │
│ Terminal         │ Approvals and artifacts inline    │ MCP/connectors       │
│ Archived         │ Result and collection state       │ Cost + budget        │
│                  │                                   │ Cache/index/memory   │
│ Filter/project   │ Steer/approve composer            │ Browser/Chromium     │
├──────────────────┴───────────────────────────────────┴──────────────────────┤
│ Current action · keyboard hints · sync/retention provenance                │
└─────────────────────────────────────────────────────────────────────────────┘
```

The transcript is the dominant surface. The inspector is collapsible. The
roster keeps active, attention, no-runtime, terminal, and archived sessions
visible without pretending they are the same thing.

The session header always shows:

1. human title and stable session ID;
2. plain lifecycle word and evidence timestamp;
3. predecessor/successor link;
4. backend and model;
5. worktree and workdir;
6. elapsed time, tokens, cost, and budget;
7. exactly one primary **Open session** or **Open successor** action.

## Beacon projection

Beacon is a projection over Port Daddy's session authority, not a second
launcher or a filesystem-inference engine.

After **Continue** is accepted, the modal remains open and becomes a successor
card. The operator sees, before dismissal:

- canonical successor session and receipt IDs;
- “continued from” predecessor link;
- `accepted`, `starting`, `live`, terminal, `no_runtime`, or `unknown`;
- workdir and worktree/branch when known;
- backend/model when known;
- transcript, artifact, and accounting collection availability;
- one **Open successor** button.

Beacon never substitutes the predecessor session as the new agent ID, invents a
worktree property, maps `running` to `live`, or treats a client observation
timeout as a failed spawn. A lost response becomes `unknown` plus a reconnect to
the same receipt.

The receipt is the durable projection, not a view over mutable source state. It
freezes predecessor lineage at admission and retains requested budget plus final
backend-reported tokens and cost after the in-memory runtime record is gone.
Concurrent exact retries wait for the owning admission to produce either the one
successor or a pre-admission terminal fact; they never manufacture an empty
accepted response.

Historical filesystem scans may populate clearly labelled archival rows. They
cannot override live daemon state or freshness provenance.

## State and language

| State | Primary text | Optional secondary copy | Motion |
|---|---|---|---|
| `accepted` | Accepted | Berth reserved | One brief acknowledgment, then still |
| `starting` | Starting | Preparing runtime; “fitting out” may follow | Slow left-to-right shimmer |
| `live` | Live | Current plain activity, such as “searching files”; nautical verb may follow | Subtle wave or wheel only while events are fresh |
| `completed` | Completed | Result sealed | No continuous motion |
| `failed` | Failed | Exact failure reason | No continuous motion |
| `cancelled` | Cancelled | Actor and reason | No continuous motion |
| `no_runtime` | No runtime | Session and transcript retained | No continuous motion |
| `unknown` | Outcome unknown | Reconnecting to receipt | Bounded reconnect pulse |
| `archived` | Archived | Retention and sync provenance | No motion |

“Circumnavigating,” “consulting sextant,” “taking soundings,” and similar voice
may appear after the exact activity text. They never replace state, tool, file,
or error information. International Code of Signals flags retain their actual
meaning; Port Daddy mappings are explicitly secondary.

## Activity presentation

The current activity line can shimmer left to right while an event is genuinely
in progress:

- `Searching files in spawn-routes.ts`
- `Editing session-flow.ts`
- `Running focused conformance tests`
- `Waiting for approval: network access`

The visual flourish can be a low-amplitude crashing wave, a small boat advancing
through the line, or a slowly turning wheel. It stops when the event ends, the
heartbeat is stale, or reduced motion is enabled. Decorative animation never
stands in for liveness.

## Permissions, connectors, and background authority

Permissions are a ledger, not a one-time modal. The inspector separates:

- requested from granted authority;
- session-only from project, account, team, or managed policy;
- foreground approval from background permission;
- filesystem, shell, network, secrets, browser, MCP, and external side effects;
- granting actor, timestamp, expiry, and revocation;
- blocked attempts and the policy that blocked them.

MCP servers, connectors, and plugins show installation, authentication, health,
tool inventory, last use, and data destination. Secrets remain references to a
keychain or managed store, never transcript text.

## Cache, index, and memory visibility

The session inspector distinguishes:

- repository code index and its commit/worktree freshness;
- embedding model and shared cache readiness;
- package/build caches and whether the current worktree can reuse them;
- prompt/context cache accounting reported by the provider;
- explicit project rules and skills;
- recalled memory, its provenance, scope, confidence, and staleness;
- local-only versus synced session history.

“Context loaded” without provenance is insufficient. The operator must be able
to see what was injected and why.

## Browser and Signal-plugin runtime

Browser automation is a versioned runtime attached to a session. The inspector
shows:

- browser engine and exact Chromium build;
- who built or downloaded it and artifact verification status;
- profile and storage partition;
- extension/Signal-plugin version and manifest;
- sandbox and network policy;
- downloads, screenshots, recordings, console, network, and accessibility logs;
- cache path and retention;
- whether the browser may continue in the background;
- connector/native-host signature and authorization.

A build is not “ready” because source compiled once. The exact Chromium and
plugin artifacts used by the agent must be named, checksummed, launch-tested,
and linked to the session proof.

## Keyboard model

Global shortcuts are stable across panes:

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

Shortcuts are discoverable in menus and the command palette, remappable, and do
not conflict with text editing or assistive technology.

## Accessibility, localization, privacy, and degraded mode

- State uses word, icon/flag, and color; never color alone.
- Body text is at least 14 px and respects OS text scaling and browser zoom.
- Motion stops under reduced-motion settings and never conveys unique data.
- Focus order follows roster, transcript, composer, then inspector; every
  control has a visible focus state and accessible name.
- Status and activity strings are localizable; IDs, paths, code, flags, and
  model names are isolated from sentence grammar.
- Transcript, sharing, sync, memory, telemetry, and retention policies show
  account/team scope and are reversible where the provider permits it.
- Offline mode preserves the last durable event cursor and labels freshness.
  “Daemon unreachable” never erases or fabricates terminal state.
- A destructive cancel says what runtime will stop and what transcript,
  commits, artifacts, and worktree state remain recoverable.

## Anti-patterns

- A green “active” dot derived from a session row.
- A success toast that creates a successor but does not reveal where it went.
- Separate transcript, agent, and attach buttons competing after continuation.
- A wall-clock timeout that kills healthy CLI work.
- A browser or daemon client that guesses a loopback port.
- Filesystem mtime presented as authoritative liveness.
- A takeover action that mutates or obscures immutable lineage.
- Hidden background permissions or connector authentication.
- Nautical copy that obscures plain state or misuses a signal flag.
- Shimmering rows that continue after activity or heartbeat freshness ends.

## Ship gate

Do not ship a continuation surface until an operator can answer these questions
from the successor card without opening a terminal:

1. What stable session was created?
2. Which session did it continue?
3. Is it accepted, starting, live, terminal, without a runtime, or unknown?
4. What evidence supports that state, and how fresh is it?
5. Where is it working?
6. Which backend/model, permissions, connectors, and sandbox does it use?
7. Where are the transcript, artifacts, usage, cost, and budget?
8. What single action opens the canonical session?
