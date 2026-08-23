# 0092. The suggestibility ladder & cloud coordination federation — make the Pilot's discipline structural, and survivable across machines

> Numbering caution: 0090 (database distribution & sync / The Harbor) and 0091
> (Giant Squid Harbor) are in-flight on other branches. 0089 is the highest on
> `main`. If 0092 collides at merge, renumber this one — it has no inbound
> references yet.

## Status

Accepted (phased; §4 implemented after the §5 gate merged)

## Context

ADR-precedent for this work is the **Port Daddy Pilot agent**
(`agents/port-daddy-pilot/`, branch `worktree-port-daddy-pilot-agent`): one
canonical operating persona — *coordinate before you cut, leave durable
evidence, keep listening, tell the truth* — rendered into every LLM runtime
(`lib/pilot-agent-render.ts`) and a Claude managed cloud agent
(`agent_01S8bG1GPXWgReKrNL9meD5V`), auto-injected at session start via
`hooks/sessionstart-pilot.mjs`.

That persona is **advisory**. It is a prompt. It tells the agent to claim a file
before editing it, but nothing *makes* it. Today coordination is enforced at
exactly two points and suggested at one:

- **Suggested** at `SessionStart` (the Pilot persona — merged to `main` via
  PR #616, `89f12c10`).
- **Enforced — hard — only** at `pre-commit`/`pre-push` (Coordination Guard +
  the macaroon capability kernel, `lib/macaroon/gate.ts`).

Everything *between* — the actual editing, where collisions actually happen — is
unenforced. The whole point of Port Daddy is that two agents must never edit the
same surface, yet the moment an edit tool fires is the one moment we say nothing.
We already own every engine needed to close this: `lib/suggestion-broker.ts`
(claim-overlap detection, suggestion payloads), `lib/symbol-claims.ts` /
`lib/symbol-conflict-matrix.ts`, `lib/blast-radius.ts`, `lib/surface-live.ts`,
`lib/coast-guard.ts`, and the formal `docs/architecture/2026-06-03-suggestibility-briefing-spec.md`.
What is missing is **wiring those engines to the other hook moments**.

### Related work (live landscape, surveyed 2026-06-27)

This ADR does not invent in a vacuum; it names a spine through work already in
flight, so the pieces converge instead of forking:

- **Suggestibility** already has a design spec (the briefing spec above) and
  in-progress branches (`design/suggestibility-briefing-spec`,
  `adr/suggestibility-and-shell`). The ladder here is the *enforcement* framing
  (hook surfaces → modes) that those briefing/shell efforts feed into — it
  generalizes them, it does not replace them.
- **The cloud plane already exists and is advancing.** `cloud-fleet` Phase A is
  merged (no-tunnel relay + queue executor, PR #599); Phase B (control-plane API,
  PR #601) and a Phase C branch are in flight. The cloud coordination peer (§4)
  must **ride that substrate** (relay + Workers/queue), not stand up a parallel
  one.
- **The DB-federation substrate is ADR-0090**, currently split across two open
  PRs — #570 (database distribution & sync) and #580 (The Harbor) — not yet
  landed. The coordination peer is downstream of whichever lands; this ADR is the
  *consumer*, not the owner, of that sync layer.
- **The trust gate already has a worktree.** The event→spawn trust substrate
  (capability gate + Phase-1 SSRF/path-traversal fixes for I/O-wiring #539, which
  itself merged as `a79dcd81`) is built and tested but **uncommitted** — and its
  ADR number collides with 0090 and needs renumbering. The §5 precondition points
  at *that* work landing, not new work.
- **Daemon survival is being addressed in parallel** by PR #607 (doctor
  three-tier supervision/liveness/drift severity). The cloud peer (§4) is the
  *coordination-layer* complement to #607's *process-layer* fix: #607 keeps the
  local daemon alive; §4 makes coordination survive even when it isn't.

Two structural problems compound this:

1. **The local daemon is a single point of failure for coordination.** The
   daemon is `localhost:9876`, launchd-supervised, and does not stay up in
   background/headless contexts (observed directly while landing the Pilot
   branch: the daemon flapped, the Coordination Guard could not verify session
   truth, and the commit was blocked — `--no-verify` was the only way out).
   Coordination should not be hostage to one process's uptime, and it cannot
   span machines or reach the cloud agent at all.

2. **Discipline is authored once but enforced nowhere portable.** The Pilot
   ships as five rendered personas, but the *hooks* that would enforce the
   persona are hand-written per repo (`.claude/settings.json`) and absent from
   Codex/Gemini.

## Decision

Adopt a **suggestibility ladder** that wires existing coordination engines to
every agent-lifecycle hook, escalating suggestion → enforcement; render it as a
**hook pack** per runtime; and back it with a **cloud coordination peer** so the
ledger survives local daemon death and reaches distributed and cloud agents —
**strictly behind the capability/trust gate.**

### 1. The suggestibility ladder (hook surface → coordination layer)

| L | Hook | Layer | Mode | Reuses |
| --- | --- | --- | --- | --- |
| L0 | SessionStart | Inject Pilot persona + sitrep/salvage/attention | advisory | `pilot-agent-render`, `attention` |
| L1 | UserPromptSubmit | Per-turn ambient nudge: rank live claims/notes/conflicts against the prompt, inject the relevant ones | suggestion | `suggestion-broker`, `surface-live` |
| L2 | PreToolUse `Edit\|Write\|MultiEdit` | **Coordinate-before-you-cut gate**: claimed by a live session → `ask`/`deny`; unclaimed → auto-claim; surface `blast-radius` + symbol-conflict | warn→enforce | `symbol-claims`, `blast-radius`, `symbol-conflict-matrix`, `coast-guard` |
| L2b | PreToolUse `Bash` | Dev-server bind → require `pd claim`/auto-resolve port; flag destructive ops | warn | port resolver |
| L3 | PostToolUse `Edit\|Write` | Auto-extend the claim/touch-set + implicit progress note | automatic | claims, notes |
| L4 | Stop / SubagentStop | Closeout gate (no result note / unclaimed edits / tests-not-run); **SubagentStop pipelines an implementer diff into an adversarial-reviewer** | enforce | `session-state`, `spawner` |
| L5 | PreCompact / SessionEnd | Checkpoint claims+notes+scope before summarization; salvage on abrupt end | continuity | salvage, forensics journal (ADR-0089) |
| L6 | pre-commit / pre-push | Coordination Guard + macaroon kernel hard block | hard | `macaroon/gate` |

L2 is the keystone: entirely local, no cloud dependency, and it converts
`blast-radius`/`symbol-claims` from *report* tools into *interception*. It is the
single highest-value rung and ships independently.

### 2. Suggestibility is a per-repo dial

Extend `agent.config.json` (and `.portdaddy/` project config) with a
`suggestibility` level — `advisory | warn | enforce`. Hooks read the level and
choose `ask` vs `deny`. A scratch repo runs L0–L1; a shared repo runs L0–L6. The
level is the single knob; the ladder is the mechanism.

### 3. Hook pack renders per-tool, like the agent

A proposed canonical `agents/port-daddy-pilot/pilot.hooks.json` rendered by a
sibling of `pilot-agent-render.ts` (`lib/pilot-hooks-render.ts`, proposed) into each runtime's native
hook format: Claude `settings.json` hooks, Codex hook-trust entries, Gemini
`hooksConfig`. "Install the Pilot" then means persona **+ discipline**,
uniformly, everywhere — installed by the same `pd setup` path.

### 4. Cloud coordination peer (federation, not authority)

Stand up a **Durable Object per project** as a strongly-consistent,
batch-synchronized **coordination room**. Each local daemon and the cloud hold a
replica of the **coordination ledger** — claims, notes, sessions, and logical
lock leases — and sync through the **existing `cloud-fleet` plane** (no-tunnel relay
+ queue executor, Phase A merged #599, control-plane Phase B #601):
`routes/relay.ts`, `lib/relay-client.ts`, `lib/dispatch/worker.ts`. This rides
that substrate rather than forking a parallel one. **Ports and process
supervision stay local** (a port binds a specific machine). Ledger conflicts
merge via the CRDT/oplog model already used by the Harbor editor. This is the
endpoint of **ADR-0090 (database distribution & sync)** — the cloud daemon is
that architecture's coordination plane.

Consequences this directly unlocks:

- The cloud agent's custom tools (`pd_preflight` / `pd_note` / `pd_status`, already
  defined on `agent_01S8bG1GPXWgReKrNL9meD5V`) get a real backend — the DO — instead
  of a self-hosted worker shelling to local `pd`.
- The cloud `multiagent` coordinator (implementer / `port-daddy-redteam`) can claim
  and note on the *same ledger* as local agents. The two transports become one
  substrate.
- The Coordination Guard can verify against the cloud replica when the local
  daemon is down — the flapping-daemon block becomes survivable.
- `swarm_awareness` becomes genuinely cross-machine.

#### §4 implementation (2026-08-23)

The shipped peer is an append-only CRDT/oplog, not a remote database mount:

- `apps/relay/src/coordination-room.ts` provides one Durable Object per project.
  Its request path only buffers operations and arms an alarm; the alarm appends
  the whole batch with one multi-key storage write. A daemon retains every
  outbox operation until a later response says it is durable, so object eviction
  before an alarm can delay acknowledgement but cannot lose the source fact.
- `lib/coordination-peer.ts` snapshots the canonical local session, note, claim,
  and project-scoped logical-lease APIs into a durable SQLite outbox, pulls
  contiguous cloud pages, and applies them back through those same local APIs.
  Local mutations never wait for this loop, and network errors leave the outbox
  intact for retry.
- Sessions, claims, and logical leases are deterministic HLC-ordered LWW
  registers; notes are immutable grow-only entries. Inbound clocks are bounded
  to five minutes of future skew and a finite logical counter, so one malformed
  peer cannot permanently dominate later honest writes. A pulled page is
  validated and applied in one SQLite transaction with its cursor advance;
  partial application rolls back before retry. Claims from different sessions
  have distinct entity identities, so a partitioned claim on either peer
  survives union on reconvergence.
- Macaroons authorize a stable actor, while every daemon process uses a unique
  replica id in its HLC and operation ids. Concurrent sandboxes therefore do
  not collapse into one CRDT replica or reuse note identities merely because
  they share the same fleet actor grant.
- Logical lock leases replicate for visibility and convergence only. They are
  not process locks, port locks, or proof of global mutual exclusion during a
  partition. Ports, PIDs, sockets, supervision, and exclusive machine-local
  resources remain local authority.
- `apps/fleet-executor/src/sandbox-runner.ts` builds the compiled binary, boots
  a real isolated daemon with `PORT_DADDY_PREFIX`, `PORT_DADDY_DB`, and
  `PORT_DADDY_SOCK`, waits for health, and creates the cloud session with the
  compiled `pd begin` path before sandbox work runs. Checkout, dependency
  installation, daemon launch, and tests are separate Sandbox process scopes:
  the repository token reaches only Git, and the coordination macaroon reaches
  only the daemon's `startProcess` environment. Install hooks, test code, and
  later `exec` calls never receive it; the returned process handle is killed in
  `finally`. This follows Cloudflare's documented per-command environment and
  background-process APIs ([Commands](https://developers.cloudflare.com/sandbox/api/commands/),
  [Environment variables](https://developers.cloudflare.com/sandbox/configuration/environment-variables/),
  [Background processes](https://developers.cloudflare.com/sandbox/guides/background-processes/)).
- An explicit remote daemon URL/profile is never replaced by direct local-DB
  fallback or local daemon auto-start after `ECONNREFUSED`. Squid hook gates use
  remote health for an explicitly selected peer and retain the filesystem-only
  readiness/heartbeat path for the implicit local daemon.

The capability prerequisite is satisfied by merged PR #632: every sync is
authorized by a first-party macaroon scoped to `coordination-sync`, project,
actor, and expiry. The grant endpoint is independently operator-gated. The
root key and per-actor macaroon are runtime secrets and never enter committed
Worker configuration.

### 5. Precondition (non-negotiable): the capability/trust gate ships first

A cloud coordination plane widens the attack surface onto the exact wound already
identified — prompt-injection on the untrusted→privileged-tool path (PR #539).
Therefore:

- **Every cloud-side ledger write rides a macaroon capability** (`lib/macaroon/gate.ts`,
  `discharge.ts`, ProVerif-proven), scoped to project + actor + verb.
- **The event→spawn path stays behind the trust gate** (the ADR-0090 event-spawn
  substrate). A webhook or relay message must not be able to spawn a privileged
  agent or forge a claim.
- The cloud daemon (§4) **must not** ship before this gate is committed and
  enforcing. §1–§3 are all-local and do not depend on it.

The event→spawn trust substrate already exists in a worktree (capability gate +
Phase-1 SSRF/path-traversal fixes for I/O-wiring #539, merged `a79dcd81`) but is
**uncommitted**; landing it (and resolving its 0090-number collision) is the gate
this ADR waits on, not new design.

## Consequences

- **Positive:** the Pilot's discipline becomes structural, not prompt-dependent;
  coordination survives local daemon death and spans machines; the cloud agent
  and local agents share one ledger; one knob (`suggestibility`) scales rigor per
  repo; discipline installs uniformly across runtimes via the hook pack.
- **Negative / cost:** PreToolUse gates add per-edit latency (mitigate: cache the
  live-claim snapshot per turn; the gate must be fast or agents route around it).
  The DO coordination room is multi-week and adds an operational surface. A
  too-aggressive `enforce` level can deadlock honest work — `ask` must always be
  escapable and `deny` reserved for genuine live conflicts.
- **Risk:** suggestibility that cries wolf gets ignored — L1/L2 nudges must be
  ranked (relevance to the current prompt/edit), not firehosed. This is why L1
  reuses the `suggestion-broker` ranking rather than dumping all claims.

## Alternatives considered

- **Cloud-as-mirror (read replica).** Local stays authority; push events to a
  Worker/D1; cloud agent reads only. Cheapest, but cloud cannot author claims —
  insufficient for the cloud `multiagent` coordinator. *Viable as Phase-0 of §4.*
- **Cloud-as-authority.** Ledger lives only in the DO; local daemons are clients.
  Solves cloud-writes and multi-machine but breaks offline-first and makes
  coordination hard-depend on connectivity. *Rejected* — offline-first is load-
  bearing for local agent work.
- **CRDT federation (chosen).** Cloud is a peer, not a master, so offline-first is
  preserved (a local daemon keeps working partitioned and reconciles on
  reconnect); it reuses the existing Harbor CRDT/oplog and the ADR-0090 sync
  layer rather than inventing a second one; and local and cloud agents converge
  on a single ledger so the two transports stop diverging. Full mechanism in §4.
- **Keep discipline prompt-only (status quo).** Rejected: the Pilot branch proved
  a persona alone does not prevent the cardinal sin — two agents editing the same
  surface, the one outcome the whole substrate exists to prevent; only
  interception at the edit moment (L2) does.

## Rollout (smallest-real-first, each independently shippable)

1. **L2 PreToolUse edit-gate + the `suggestibility` dial.** All-local, reuses
   the existing Giant Squid hook pack (`bin/pd-hook-pre-tool`) as the first
   interception path. The dial resolves as `PD_SUGGESTIBILITY` override, then
   the nearest `agent.config.json`, `.portdaddy/suggestibility.json`, or
   `.portdaddy/project.json`, then default `enforce` for pre-ADR repos. The
   first slice gates local foreign-lock conflicts as `advisory | warn | enforce`
   and resolves relative edit/patch paths against the hook event `cwd`;
   symbol-conflict and blast-radius enrichment stay as follow-on work. Ships the
   day it lands.
2. **L1 ambient nudge + `lib/pilot-hooks-render.ts` hook pack** (proposed) across
   Claude/Codex/Gemini, installed by `pd setup` (mirrors the agent renderer).
3. **L4 SubagentStop adversarial-pipeline + L5 PreCompact checkpoint.**
4. **Cloud coordination peer (§4), gated behind the macaroon/trust-gate
   precondition (§5).** Implemented as a bidirectional DO/local CRDT peer after
   PR #632 merged; the compiled two-daemon smoke proves begin, claims,
   bidirectional notes, and partition reconvergence.

## Citations

- Existing: `lib/suggestion-broker.ts`, `lib/symbol-claims.ts`,
  `lib/symbol-conflict-matrix.ts`, `lib/blast-radius.ts`, `lib/surface-live.ts`,
  `lib/coast-guard.ts`, `lib/macaroon/gate.ts`, `routes/relay.ts`,
  `lib/relay-client.ts`, `lib/dispatch/worker.ts`,
  `docs/architecture/2026-06-03-suggestibility-briefing-spec.md`, ADR-0089
  (forensics journal), ADR-0090 (database distribution & sync).
- Pilot (merged, PR #616 `89f12c10`): `agents/port-daddy-pilot/`,
  `lib/pilot-agent-render.ts`, `lib/pilot-sessionstart-hook.ts`,
  `hooks/sessionstart-pilot.mjs`, `config/managed-agents.json`,
  `docs/agents/port-daddy-pilot-multiagent.md`.
- In-flight to reconcile with: PR #570 / #580 (ADR-0090 DB distribution / The
  Harbor), PR #599 / #601 (cloud-fleet Phase A merged / Phase B), PR #607 (doctor
  supervision severity), PR #539 (`a79dcd81`, I/O-wiring Phase 1) + the
  uncommitted event-spawn trust substrate, branches
  `design/suggestibility-briefing-spec` and `adr/suggestibility-and-shell`.
- Proposed: `lib/pilot-hooks-render.ts`, `agents/port-daddy-pilot/pilot.hooks.json`.
- Implemented §4: `lib/coordination-ledger.ts`, `lib/coordination-peer.ts`,
  `apps/relay/src/coordination-room.ts`, `apps/relay/src/coordination-auth.ts`,
  `apps/relay/src/coordination.ts`, `apps/fleet-executor/src/sandbox-runner.ts`,
  `scripts/smoke-coordination-peer.sh`; macaroon prerequisite PR #632.
- Cloudflare Sandbox process/environment contract:
  [Commands](https://developers.cloudflare.com/sandbox/api/commands/),
  [Environment variables](https://developers.cloudflare.com/sandbox/configuration/environment-variables/),
  [Background processes](https://developers.cloudflare.com/sandbox/guides/background-processes/).
