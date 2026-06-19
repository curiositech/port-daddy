# 0008. Agent Resurrection Pattern for Dead-Agent Recovery

## Status

Accepted

## Context

Multi-agent AI development introduces a failure mode that traditional software does not have: an agent can die mid-task without any clean shutdown signal. An AI agent's session can end because:

- Its context window fills up
- The user closes the IDE or terminal
- A network timeout occurs during a long-running task
- The machine sleeps and the heartbeat timeout expires
- The agent encounters an error it cannot recover from

When an agent dies mid-task, two things are at risk:
1. **Lost context**: The work the agent was doing, the files it was editing, the decisions it made — all of this context lives in the agent's notes and session. If these are simply discarded, a replacement agent starts from zero.
2. **Orphaned resources**: Locks held by the dead agent remain held indefinitely (preventing other agents from proceeding). File claims remain active. Any work the dead agent started but did not finish may be in an inconsistent state.

The naive solution — "just check if agents are alive and clean up their resources" — addresses orphaned resources but discards the context. Port Daddy's resurrection system addresses both.

## Decision Drivers

- **Context preservation**: A replacement agent should be able to read the dead agent's notes and understand what was done, what is left to do, and what decisions were made.
- **Automatic detection**: Agent death must be detected automatically, not require manual intervention.
- **Graceful handoff**: The system should not simply delete dead agents — it should queue them for review so a replacement can claim their context.
- **Sleep tolerance**: Laptops sleep. An agent that misses heartbeats because the machine was asleep should not be immediately declared dead on wake.
- **Opt-in continuation**: The replacement agent should actively claim the dead agent's work, not have it pushed automatically. The replacement agent may decide the dead agent's work is irrelevant.

## Considered Options

### Option A: Resurrection queue with heartbeat-based detection

Agents register with the daemon and send periodic heartbeats. The daemon has a cleanup loop that runs every N minutes. When an agent stops heartbeating past a threshold:

1. It is marked stale (missed one heartbeat window)
2. If still not heartbeating after a longer threshold, it is marked dead
3. Dead agents with active sessions are moved to a `resurrection_queue` table, with their session ID and notes preserved
4. The agent record is deleted; the session is left in `active` state (not ended)
5. A new agent can run `pd salvage` to see the resurrection queue
6. The new agent runs `pd salvage claim <dead-agent-id>` to officially take ownership
7. Events are emitted on the `resurrection` pub/sub channel so other agents can react

**Pros:**
- Context is preserved in the existing session notes — no additional storage needed
- The queue persists across daemon restarts (SQLite-backed)
- New agents get a clear, curated view of abandoned work
- Sleep detection prevents false positives on laptops

**Cons:**
- Complexity: requires heartbeat infrastructure, a background reaper loop, state machine transitions, and an event emitter
- The threshold tuning (stale at 10 min, dead at 20 min by default) requires calibration

### Option B: Session-based context without agent lifecycle

Simplify to sessions only: agents do not register or heartbeat. Sessions are created explicitly and ended explicitly. If an agent crashes mid-session, the session remains `active` until another agent ends it.

**Pros:**
- Much simpler — no heartbeat infrastructure, no resurrection queue, no reaper

**Cons:**
- No automatic detection of abandoned sessions — a human must manually run `pd session end` for crashed agents
- No canonical "what was this agent doing" context — another agent must know to look for abandoned sessions
- No lock release — locks held by the crashed agent remain forever

### Option C: Process-based liveness check (PID monitoring)

Instead of heartbeats, track the agent's PID. If the PID is no longer alive, clean up.

**Pros:**
- Instantaneous detection — PID death is immediate
- No heartbeat overhead

**Cons:**
- PID-based detection only works if the agent process itself is dead. An agent whose context window filled up may still have a running process (the IDE) even though it is no longer executing the agent's code.
- Does not work across machine boundaries (e.g., a remote agent)
- PID reuse means a new unrelated process could have the same PID as a dead agent

### Option D: External watchdog process

A separate watchdog process monitors agents and performs cleanup.

**Pros:**
- Separation of concerns

**Cons:**
- Adds an additional process to manage
- Port Daddy is already a daemon — adding a second daemon increases operational complexity
- The reaper logic can live in the daemon's cleanup loop without a separate process

## Decision

Implement **heartbeat-based agent lifecycle tracking with a resurrection queue and sleep detection**.

The system has three components:

**1. Heartbeat infrastructure (`lib/agents.ts`):**
- Agents register with `POST /agents` (body: `{ id, name, purpose, identity }`)
- Agents send heartbeats with `POST /agents/:id/heartbeat` every 30 seconds (recommended interval)
- `last_heartbeat` timestamp is updated on each heartbeat
- `isActive` is computed at read time: `(now - lastHeartbeat) < DEFAULT_AGENT_TTL` (2 minutes)

**2. The reaper (cleanup loop in `server.ts`):**
- Runs every 5 minutes (configurable via `config.cleanup.interval_ms`)
- Iterates all agents: for any `isActive = false`, calls `resurrection.check()`
- `resurrection.check()` maintains state machine: `pending` → `stale` → `dead`
- Dead agents with active sessions are inserted into `resurrection_queue`
- Events emitted on `'agent:stale'`, `'agent:dead'`, `'agent:resurrected'`
- Dead agents deleted from `agents` table after entering the queue

**3. Sleep detection (also in `server.ts`):**
- A lightweight interval checks elapsed time every 30 seconds
- If more than 60 seconds elapsed since the last check, the machine was asleep
- On detected sleep, a 5-minute grace period begins (`sleepGraceUntil`)
- During the grace period, the reaper skips agent death checks entirely
- This prevents the laptop-sleep false-positive: an agent heartbeating normally is not killed just because the machine was asleep

**The resurrection queue (`lib/resurrection.ts`):**
- `resurrection_queue` table stores: agent ID, name, session ID, purpose, detected_at, status, resurrection_attempts
- Status transitions: `pending` → `claimed` → `done`
- `GET /resurrection` lists the queue, filterable by project
- `POST /resurrection/claim/:agentId` — a new agent claims a dead agent's work; the claiming agent ID is recorded
- `POST /resurrection/reap` — manually trigger the reaper (useful for testing and debugging)

## Rationale

The heartbeat approach was chosen over PID-based detection because it handles the primary failure mode for AI agents: context window exhaustion. An AI agent that runs out of context does not necessarily die as an OS process — its parent environment (IDE, terminal) continues running. Only missed heartbeats reliably detect "the agent is no longer functioning."

The resurrection queue, rather than immediate cleanup, was chosen to give the development team observability into what happened. `pd salvage` shows what was being worked on; `pd salvage claim` is a deliberate act that creates accountability and a trail. This is especially important in multi-agent systems where understanding which agent did what is crucial for debugging.

Sleep detection addresses a real failure mode on laptop development: a developer's machine sleeps overnight, and every agent registered with Port Daddy would be declared dead on wake (since their heartbeats stopped during sleep). A 5-minute grace period gives agents time to reconnect and resume heartbeating without being killed.

The events emitted on agent state transitions (`agent:stale`, `agent:dead`, `agent:resurrected`) are published to the pub/sub messaging system, allowing other agents to react in real-time — for example, an orchestrator agent could automatically claim dead agents in its project scope.

## Consequences

### Positive

- Dead agents' context (session notes, file claims, purpose) is preserved for new agents to review
- Locks held by dead agents are released during cleanup (via `agents.cleanup(locks)` in `server.ts`)
- The system is self-healing: new agents discover abandoned work via `pd salvage` without human intervention
- Sleep detection prevents a common false-positive on developer laptops
- The `pd salvage --project myapp` filter (using the `identity_project` index) makes it practical to find only the dead agents relevant to the current project

### Negative

- The heartbeat interval (30 seconds) and TTL (2 minutes) mean there is always a detection lag of up to 2 minutes between agent death and resurrection queue entry
- The reaper only runs every 5 minutes, adding additional lag
- A developer must opt into the resurrection system — if agents do not register or heartbeat, resurrection cannot help them

### Neutral

- The `resurrection_queue` survives daemon restarts (SQLite-backed), so abandoned work is not lost even if the daemon is restarted
- The `pd salvage` workflow requires a new agent to actively claim dead work — there is no forced assignment. This is intentional: the new agent may determine the dead agent's work is irrelevant to its current task.
- The daemon's CLAUDE.md documents a manual debugging workflow: backdate a heartbeat with SQLite, trigger the reaper via HTTP, then run `pd salvage` to verify the queue. This is useful for testing the resurrection system without waiting for an actual agent death.
