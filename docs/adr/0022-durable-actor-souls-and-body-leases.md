# 0022. Durable Actor Souls and Ephemeral Body Leases

## Status

Proposed (2026-04-23). Reconciles ADR-0008 with the actor model in
`docs/shipwright/AGENT-MODEL.md`.

## Context

Port Daddy now has two competing meanings for "agent."

The older runtime model treats a row in `agents` as a live process/body lease.
`pd begin` registers the row, heartbeats keep it fresh, `pd done` unregisters
it, and stale-agent cleanup deletes the row after releasing locks. That model is
embedded in `lib/agents.ts`, `lib/sugar.ts`, `lib/sessions.ts`,
`lib/ipc-auth.ts`, and the current Fleet Control Center.

The newer actor model says every agent has a durable daemon-side "soul": stable
identity, mailbox, persistent belief state, supervision policy, and behavior.
Bodies are optional attachments: a child process, shell session, LLM invocation,
or human terminal. A body can die; the soul remains addressable and may be
adopted by a new body through salvage.

Those models cannot be reconciled by simply keeping rows forever. Row deletion
currently drives orphan detection, lock cleanup, IPC authorization, Arbiter
checks, and salvage visibility. Removing deletion without replacing those
semantics would preserve history while weakening ownership and recovery.

## Decision

Adopt the soul/body split as the target runtime model:

1. **Actor soul:** durable identity, mailbox, history, archetype, and belief
   state. A soul is addressable even when no body is currently attached.
2. **Body lease:** ephemeral live attachment with heartbeat, PID/process
   metadata, transport connection, incarnation number, and authority to perform
   sensitive actions.
3. **Salvage:** recovery of a dead or revoked body lease attached to a durable
   soul, not resurrection of a deleted identity.
4. **Inbox:** actor-scoped mailbox. Messages may be queued for a soul whether
   or not a live body is attached. Waking a body is a separate delivery concern.
5. **Authorization:** protected IPC/HTTP operations require a live body lease or
   explicit delegated token, not mere existence of a soul.
6. **Back compatibility:** `/agents` remains the live-body compatibility view.
   Add `/actors` as the durable soul view and migrate clients gradually.

The core invariant becomes: **do not delete souls as routine lifecycle cleanup;
expire or revoke bodies instead.**

## Rationale

This is the only model that makes the documented actor architecture, salvage,
inbox, fleet scheduling, and remote harbor roadmap fit together.

Actor addressability solves the "no live fleet agent" blind spot in the current
control plane. It lets operators message configured or dormant agents, inspect
their history, and resume work without needing a live registry row.

Body leases keep the security boundary crisp. A stale terminal or process that
still knows an `agentId` must not be able to acquire locks, close sessions, or
claim salvage after its lease has expired. Lease fencing also gives the Arbiter
and merge queue a precise owner for mutable work while keeping the durable soul
available for attribution and handoff.

The same split also addresses spawn storms. `project`, `fleet`, `agent`,
`harbor`, `sortie`, and trigger identities can become mailbox-owning actors
whose activation policy owns cooldown, dedupe, backoff, singleton, and budget
decisions. Tuples, pub/sub, trie, graph, and pheromones remain shared media; they
do not decide when expensive bodies should wake.

## Consequences

### Positive

- Historical agent records stop disappearing during normal cleanup.
- Inbox and control-plane surfaces can target dormant but valid actors.
- Salvage becomes adoption of preserved state instead of reconstruction from a
  queue shadow.
- IPC, locks, merge queue, and Arbiter checks gain a stronger authority model
  through lease fencing.
- Fleet scheduling has a natural place to collapse repeated triggers before
  spending API calls.

### Negative

- The current "registered agent" contract must split into `actor exists` and
  `body lease is live`.
- `pd done`, spawner cleanup, stale-agent cleanup, and session orphan repair all
  need migration.
- UI models that collapse registry, spawn, salvage, and configured fleet agents
  into one row need redesign.
- Existing docs and tests that assert "done unregisters the agent" need to be
  updated with compatibility language.

### Neutral

- `agents` may remain the compatibility table in the first migration if new
  columns make soul/body state explicit. A separate `actors` +
  `actor_body_leases` schema is clearer long term.
- `resurrection_queue` can remain as a compatibility projection while salvage
  moves toward lease adoption.
- Existing inbox storage is already keyed by `agent_id` without a foreign key,
  so actor-scoped mailbox behavior is closer to current code than the docs imply.

## Migration Path

1. Add a durable actor read model:
   - `GET /actors`
   - `GET /actors/:id`
   - `POST /actors/:id/message`
   - include archetype, mailbox depth, last activation, live lease state, recent
     sessions, and recent salvage state.
2. Add body lease state:
   - incarnation/generation number
   - lease status (`attached`, `draining`, `detached`, `dead`, `revoked`)
   - heartbeat timestamp
   - owning PID/process/transport metadata
   - optional lease token for protected operations
3. Change normal completion:
   - `pd done` ends the session and detaches the current body lease
   - it does not delete the durable actor soul
   - compatibility responses may keep `agentUnregistered` for one release but
     should mark it deprecated.
4. Change stale cleanup:
   - release locks and active resources owned by the dead body lease
   - mark the lease dead or revoked
   - enqueue salvage/adoption state on the soul
   - stop using missing agent rows as the orphan-session signal.
5. Change auth and invariants:
   - IPC protected actions validate a live body lease or delegated token
   - Arbiter checks lock/session/merge ownership against live lease authority and
     durable soul attribution.
6. Change UI:
   - Fleet Control Center lists actors as durable identities
   - live registry becomes a deployment/lease column, not existence truth
   - salvage ghosts become recovery states on an actor
   - direct messages can be queued for dormant actors, with wake status shown
     separately.
7. Change docs and tests:
   - update SDK/OpenAPI/site docs from "registered agent" language to
     actor/body terminology
   - add regression tests proving done preserves the soul, stale cleanup revokes
     only the lease, inbox survives detachment, and stale leases cannot perform
     protected actions.

## Open Questions

- Should the first implementation add `actors` + `actor_body_leases`, or evolve
  `agents` in place and create `/actors` as a projection?
- What is the retention policy for ephemeral spawned actors whose identity is
  only `spawned-*`?
- Should configured fleet agents pre-create durable souls at `pd fleet init`, or
  only at `pd fleet up`?
- Which lease token mechanism is enough for local-only IPC before remote harbor
  identity and key distribution lands?
