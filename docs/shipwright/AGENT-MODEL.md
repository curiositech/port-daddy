# AGENT-MODEL · the Plane

> *"Every agent has a soul in the daemon and, sometimes, a body in the world.
> The soul is always addressable; the body comes and goes."*

**Status:** Reconciliation — 2026-04-19
**Scope:** The unifying runtime for every agent in Port Daddy, not just Shipwright.
**Supersedes:** the "actor runtime is 30 lines of glue" framing in
`SHIPWRIGHT-DAEMON.md` v1 (which wasn't honest — it IS new infrastructure;
the honest claim is that Port Daddy's existing primitives map onto it
one-to-one).
**Skills invoked:** `always-on-agent-architecture`, `agha-actor-model`,
`hoare-1978-csp`, `bdi-agency-model`, `fipa-00037-communicative-act-library`,
`ostrom-commons-governance`, `klein-1998-sources-of-power`, `park-2023-generative-agents`.

---

## 0. Why this doc exists

The first draft of `SHIPWRIGHT-DAEMON.md` described a virtual actor runtime
— mailboxes, belief state, `ActorRef.ask`, idle deactivation — and said
Port Daddy already had it. That was half true and half a lie.

**True:** the daemon's coordination primitives (agents, sessions, inbox,
pheromones, tuples, salvage) do form an actor-runtime-in-disguise.
**Lie:** today's fleet scripts, `pd spawn` children, `pd begin` shell
sessions, and daemon-internal modules *do not* go through anything that
looks like an actor runtime. They each use a handful of those primitives
in different shapes. Shipwright was drafted on a level of abstraction
that nothing else in Port Daddy reached.

That's fragmentation. The fix is not to pull Shipwright back down; it's
to **lift every agent up to the same plane**. This doc is that lift.

---

## 1. Soul and body

```
        ┌──────────────────────────────────────┐
        │                                      │
        │   THE PLANE    (daemon-internal)     │
        │                                      │
        │   ┌─SOUL─┐  ┌─SOUL─┐  ┌─SOUL─┐       │
        │   │ hawk │  │scribe│  │ship- │       │
        │   │      │  │      │  │wright│       │
        │   └──▲───┘  └──▲───┘  └──▲───┘       │
        │      │         │         │           │
        └──────┼─────────┼─────────┼───────────┘
               │         │         │
               │         │         │   HTTP API / IPC
               │         │         │   (existing)
          ┌────▼───┐  ┌──▼────┐    │
          │ child  │  │ shell │    │  (Shipwright has no body —
          │ proc   │  │ script│    │   it lives entirely on the Plane)
          │ (claude│  │ (dev  │    │
          │  -cli) │  │  term)│    │
          └────────┘  └───────┘    │
            BODY         BODY      │
```

- **Soul.** The addressable daemon-side actor: an identity, a mailbox,
  a persistent belief state, a supervisor, and a behavior (the `receive`
  function that turns messages into next-state). Always present once
  registered, always reachable by identity, cheap when idle.
- **Body.** Optional. A child process, a shell script, an LLM invocation,
  a human's terminal session. Talks to its soul via the HTTP API or the
  IPC socket — *exactly* the interfaces Port Daddy already exposes. A
  body can die; its soul persists. A new body can adopt the soul (that's
  the salvage queue, generalized).
- **The Plane.** The collection of all souls plus the shared
  infrastructure they sit in: SQLite-backed state, pub/sub messaging,
  pheromone broadcasts, tuple space, bond escrow, budget guard, Arbiter
  invariants, activity log.

Everything we've been building maps onto this picture. This doc says so
out loud.

---

## 2. Port Daddy has been an actor runtime all along

| Actor-runtime concept | What Port Daddy calls it today | Module(s) |
|---|---|---|
| Actor identity | agent identity (`<project>:<stack>:<context>`) | `lib/identity.ts`, `agents` table |
| Actor registry | agent registry | `lib/agents.ts`, `agents` table |
| Mailbox | agent inbox (FIFO, per-agent) | `lib/agent-inbox.ts`, `agent_inbox` table |
| Persistent belief state | session + notes (append-only) | `lib/sessions.ts`, `session_notes` table |
| File-level intentions | file claims (advisory) | part of sessions, `session_files` table |
| Outbound message (addressed) | `agents/:id/inbox` POST | `routes/agents.ts` |
| Outbound message (broadcast) | pub/sub channel publish | `lib/messaging.ts` |
| Ambient signal (no target) | pheromone spray | `lib/pheromone.ts` |
| Shared blackboard | tuple space | `lib/tuples.ts` |
| Liveness heartbeat | agent heartbeat | `lib/agents.ts` |
| Supervision / crash recovery | salvage queue | `lib/resurrection.ts` |
| Capability token for expensive handlers | **bond escrow** (new) | `lib/bonds.ts` |
| Admission control on handler activation | **budget guard** (new) | `lib/budget-guard.ts` |
| Invariant enforcement across state transitions | Arbiter | `lib/arbiter.ts` |
| Actor activation lifecycle | `pd begin` / `pd done` | `lib/sugar.ts` |
| External body attachment | `pd spawn` | `lib/spawner.ts` |
| Group supervision | fleet runner | `lib/fleet-engine.ts`, `lib/fleet-daemon.ts` |

The actor runtime is not a new subsystem we bolt on. It is the **name**
for what the union of those modules already does. `lib/actors.ts` is the
thin glue that exposes a uniform interface; it does not replace anything.

---

## 3. Archetypes — one catalog for every agent

Every agent has an **archetype**: a behavior + supervision policy + cost
model. Seven archetypes cover every agent type currently in Port Daddy
plus the ones Shipwright proposes.

### 3.1 `process-bound` (the default)

The implicit archetype for any agent registered via `pd begin`, `pd spawn`,
or the legacy `pd agent register`. Its `receive` handler:

```
on heartbeat     → update last_heartbeat
on claim-file    → append file claim (enforce no-overlap via file-claim invariant)
on note          → append to session_notes (immutable, audited)
on end-session   → mark session completed, refund bond if any
on body-exit(ok) → mark clean exit; soul stays addressable for N minutes
on body-exit(bad)→ push to salvage queue, soul available to new body
on watchdog      → if last_heartbeat > threshold → salvage
```

No LLM calls, no spawns — a pure state-keeping actor. This is the soul
of every human developer session, every `pd spawn --backend ollama`
child, every `pd begin` shell script. They don't *know* they're actors.
They talk HTTP and the Plane does the rest.

**Cost:** zero compute, zero tokens. It's bookkeeping.

### 3.2 `fleet-scheduled`

Triggered by cron, file-watch, or CI-delta. The handler:

```
on trigger.fire  → preflight via budget-guard
                 → escrow bond
                 → spawn body (LLM or process)
                 → relay body I/O as notes
                 → on body-exit: refund or slash bond
                 → idle until next trigger
```

QA Sentinel, Typesafety, Documentarian, Perf Hawk, Gardener, Spark all
fit here. Shipwright already described this well — just with "fleet
actor" language; now it's explicit.

**Cost:** amortized LLM spend per trigger. Bond-gated.

### 3.3 `fleet-reactive`

Same shape as 3.2 but triggered by webhooks or tuple patterns, not
scheduled. Sentry Responder (on `sentry.alert` webhook), Browser Canary
(on `deploy.complete` tuple), merge-queue workers (on `merge.ready`).

Difference from 3.2: no deterministic schedule, so rate-limiting lives
inside the handler (token-bucket per agent), not in a cron registry.

**Cost:** bursty. Bond and budget critical.

### 3.4 `daemon-internal`

No body at all. Pure soul — a long-running coordinator that receives
messages and mutates state. Examples in Port Daddy today:

- `lib/fleet-daemon.ts` → archetype `fleet-supervisor`
- `lib/orchestrator-plugins.ts` → archetype `merge-orchestrator`
- `lib/arbiter.ts` → archetype `arbiter`
- `lib/merge-queue.ts` → archetype `merge-queue`
- `lib/symbol-index.ts` → archetype `symbol-index`
- `lib/skill-index.ts` (new) → archetype `skill-index`
- `lib/episodes.ts` (new) → archetype `episodic-memory`

These are all written as plain modules today. Lifting them to actors
means: each one has an identity (`daemon:arbiter`, `daemon:merge-queue`,
etc.), an inbox, a state table, observable messages. They stop being
"functions other code calls" and become "agents other agents talk to."

This matters because today, if you ask "what is the Arbiter doing right
now?" there is no answer except "read the code." After the lift, the
answer is "query `daemon:arbiter`'s mailbox and state" — same as any
other agent.

**Cost:** daemon compute only. No tokens.

### 3.5 `shipwright`

Opus-class meta-agent. Described in `SHIPWRIGHT-DAEMON.md` — but that
doc is now one archetype doc among seven, not the runtime doc.

### 3.6 `human-collaborator`

A developer running `pd begin --identity port-daddy:dev:erich`. Their
shell sessions, notes, file claims all land on their soul. When someone
else (a fleet agent, another dev, Shipwright) asks "what is erich
doing?" they get erich's soul's current state as the answer — no one
reads `.tmuxinator.yml` or guesses.

This is the quietest but maybe the most important archetype. It says:
**humans and agents are peers on the Plane.** Same vocabulary, same
observability, same supervision semantics. The difference is only in the
body.

**Cost:** zero (unless the human has also bound an LLM body to their
identity, in which case that body's spend counts against the wallet).

### 3.7 `salvaged`

Transient archetype. When a body dies mid-task, the soul enters the
salvage queue. A claiming body sends `adopt` — the soul's archetype
flips back to whatever it was (usually `process-bound` or
`fleet-scheduled`), with the adopting body bound. State is preserved.
The only state change during salvaged is "awaiting claimant."

---

## 4. Rules of the Plane (Hewitt's three axioms, trimmed)

On receipt of a message, an actor may:

1. **Send** a finite number of messages to other actors (by identity).
2. **Create** a finite number of new actors (identities).
3. **Designate** the behavior used to process the next message (i.e.,
   return a next state, or swap its archetype).

Anything else is infrastructure (persistence, bonds, supervision,
observability) — handled by the Plane, not the actor's code.

Plus two Port-Daddy-specific rules:

4. **Bond before body.** An actor handler that intends to spawn a body
   (LLM call, child process) must pass through `bonds.escrow` and
   `budget-guard.canSpawn` first. No-bond spawns are banned at the
   runtime level.
5. **No silent death.** A handler that throws goes to salvage. A bond
   held by a throwing handler gets slashed proportional to the scope of
   the damage (configurable per-archetype). Ostrom would call this
   graduated sanctions.

---

## 5. Message vocabulary (FIPA-lite)

Performatives Port Daddy uses across all archetypes. Not a wire format —
a shared vocabulary so audit trails are uniform.

| Performative | Used for | Already in PD as |
|---|---|---|
| `inform` | one-way data broadcast | pub/sub publish, pheromone spray |
| `request` | bounded action request (with reply-to) | inbox POST, `/locks/:name` POST |
| `ask` / `reply` | RPC-style query | HTTP synchronous routes |
| `propose`/`accept`/`reject` | negotiation | merge-queue plugin contract |
| `subscribe`/`cancel` | pub/sub registration | SSE subscribe endpoints |
| `failure` | error reply | HTTP 4xx/5xx JSON bodies |
| `not-understood` | unknown message kind | fallback in receive() |

Adopting the FIPA vocabulary means every `INFORM hawk pheromone=0.8`
line in the activity log tells a reader exactly what kind of
interaction happened without decoding the semantics from context.

---

## 6. Migration — zero scripts break

We're not rewriting anyone's shell scripts. The HTTP API stays identical.

**Phase 1 (lands with bond enforcement, Track 1).**
- `lib/actors.ts` runtime ships, plus the `process-bound` archetype.
- `agents` table gains an `archetype TEXT DEFAULT 'process-bound'`
  column.
- Every existing code path (`pd begin`, `pd spawn`, heartbeats, file
  claims, notes) routes through the runtime via a shim. Externally
  visible behavior: identical.
- New endpoint `/actors/:id` exposes the soul's state + last-N inbox
  messages. Purely additive observability.

**Phase 2 (lands with Shipwright, Track 2).**
- Port Shipwright to `archetype: shipwright`.
- Port the 12 canonical fleet archetypes from `SHIPWRIGHT-DESIGN.md` to
  `fleet-scheduled` / `fleet-reactive` behaviors under `lib/archetypes/`.
- Fleet-daemon stops managing process lifecycle directly; it delegates
  to actor activation.

**Phase 3 (cleanup).**
- Port the daemon-internal modules (arbiter, merge-queue,
  orchestrator-plugins, symbol-index) to daemon-internal archetypes.
- Each gains a stable identity (`daemon:arbiter`, etc.) and appears in
  the `/actors` listing. FleetControl dashboard can now show arbiter
  state alongside agent state.
- The old procedural entry points stay for back-compat; they now
  delegate to the actor.

**Phase 4 (aspirational).**
- Cross-daemon actor addressing: `jury_rig@machine-2:fleet:hawk`.
- Requires signed messages over the IPC socket (we explicitly punt this
  in v1).

No phase is urgent. Phase 1 is a small refactor; Phase 2 is the work we
were going to do for Shipwright anyway.

---

## 7. What callers see change

For the HTTP API, the CLI, the MCP, the dashboard: **nothing that
breaks existing expectations.** Only additions:

- `GET /actors` — list every soul with its archetype, last activation,
  mailbox depth, belief-state summary.
- `GET /actors/:id` — one soul's full state and recent messages.
- `POST /actors/:id/message` — the generic `tell` — underpins the
  archetype-specific routes but isn't a replacement.
- Richer activity log: every message is now a row with `kind`,
  `performative`, `from`, `to`, `correlationId`.
- FleetControl Panel renders this log in its audit strip (already shown
  in the 04 mock).

---

## 8. Philosophy — why the actor model is the right unifying frame

Because every alternative we considered collapses into it.

- **"Just use pub/sub."** Pub/sub is great for broadcasts but has no
  identity semantics, no supervision, no state. Actors are pub/sub plus
  the rest.
- **"Just use processes."** Processes are great bodies but are the wrong
  abstraction for souls — they die, consume too much memory for tiny
  state-keepers, and tie lifecycle to OS semantics.
- **"Just use CSP channels."** CSP (Hoare 1978) is about synchronous
  rendezvous over anonymous channels. Works for pipelines; doesn't give
  us addressability or supervision.
- **"Just use BDI."** BDI (Rao/Georgeff 1991) is a *reasoning* model —
  beliefs, desires, intentions. It maps cleanly onto actor state
  (belief = state, desire = goal message, intention = current behavior)
  but it says nothing about the runtime. Actors + BDI is a good
  couple — actors do the plumbing, BDI does the thinking.
- **"Just use FIPA."** FIPA is the *vocabulary* for actor
  communication, not the runtime.

The union — Hewitt actors as the runtime, BDI as the optional reasoning
layer inside an archetype's `receive`, FIPA as the vocabulary, Ostrom as
the governance — is exactly what Port Daddy has been growing toward.
Naming it is the gift.

> *"The actor model is the most important thing that has not yet
> happened to computing."* — Carl Hewitt, paraphrased from many
> interviews. For Port Daddy it happens here, quietly, with very
> little new code.

---

## 9. Closing

Shipwright is not a special agent that lives on a different plane. It
is one archetype among seven, albeit the smartest and most expensive.
Every agent in Port Daddy — the fleet Gardener that runs hourly, the
Typesafety sweeper watching `**/*.ts`, the shell script that claims a
few files and writes notes, Erich himself when he runs `pd begin` —
has a soul in the daemon. Every soul is addressable, observable,
supervised, and optionally bonded.

The Plane was always here. This doc is just the part where we
decorate the air.

---

*Companion docs:
`SHIP-GRAMMAR.md` (what agents look like),
`FLEETCONTROL-HARDENING.md` (how bonds and budgets enforce),
`SHIPWRIGHT-DAEMON.md` (the Shipwright archetype, specifically),
`COMPONENT-BRIEF.md` (how the UI renders souls and bodies),
`preview/index.html` (seeing is believing).*
