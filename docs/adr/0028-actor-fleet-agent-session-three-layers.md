# 0028. Actor / Fleet Agent / Session — three layers, one identity model

## Status

Accepted

## Context

Port Daddy has three concepts that look like agents and are easy to conflate:

1. **Canonical actors** — `lib/actor-roster.ts` defines ten roles
   (`gardener`, `qa`, `test-hunter`, `documentarian`, `simplifier`, `coxswain`,
   `quartermaster`, `cartographer`, `spark`, `spider`). Each has a stable ID,
   a mailbox at `actor:<id>`, an `owns` list, and a mission.
2. **Fleet agents** — long-running shell-spawned processes declared in
   `pd-fleet.yml` and shipped as `fleet/*` binaries / shell scripts. They
   embody actors at runtime.
3. **Sessions** — ephemeral `pd begin` / `pd done` work-slices that announce
   "I am editing these files right now."

Operators kept asking the same question in different shapes: "is `cartographer`
an agent or an actor? what's the difference between sending it a message and
spawning it? if the gardener fleet binary dies, what happens to its
work-in-progress?" The mental model existed in several heads but not in a
canonical document. ADR-0022 (Durable Actor Souls and Body Leases) introduced
the actor/lease split but treated sessions as out-of-scope; this ADR
completes the picture.

The recent `pd help actors` ghost-actor incident — four canonical names
advertised that didn't exist in the registry — was a downstream symptom of
the same fuzziness. The same applied to the *"maritime actors"* naming carried
by `lib/maritime-actors.ts` (renamed to `lib/actor-roster.ts` in
PR #52): the qualifier reached for a ship's-crew metaphor that only fit half
the roster, leaving operators unsure what category the term named.

## Decision

Fix the model by making three layers explicit, naming each, and pinning each
to its lifetime and storage.

### Layer 1 — Actor (durable role + mailbox)

- **What it is.** A stable role: ID, mailbox, mission, owned surface area.
- **Where it lives.** `lib/actor-roster.ts` (the static record) and SQLite
  (mailbox messages, last-seen timestamps).
- **Lifetime.** Permanent. Defined in source code and persisted in the DB.
  Survives daemon restart, host reboot, fleet termination, salvage, schema
  migrations.
- **What it can do directly.** Receive messages
  (`pd actor <id> --message "..."`), expose a queryable inbox, advertise an
  `owns` surface, hint at a compatibility fleet body.
- **What it cannot do directly.** Mutate state. An actor with no live
  embodiment is a mailbox waiting to be read.

### Layer 2 — Fleet agent (optional live body)

- **What it is.** A process that picks up an actor's mailbox and acts on its
  behalf — typically a long-running binary or shell script under `fleet/`,
  declared in `pd-fleet.yml`, spawned by `pd fleet up`.
- **Where it lives.** OS process table; status mirrored to the daemon via the
  agent registry (`/agents/...`).
- **Lifetime.** Process-bound. Dies when the process dies. Can be restarted,
  replaced, run on different hardware, or stay absent indefinitely without
  the actor identity disappearing.
- **What it can do.** Open sessions, claim files, read its actor's mailbox,
  run the work the actor is responsible for, write notes, mutate state under
  its body lease (per ADR-0022).
- **Bridge to Layer 1.** The actor record's `compatibilityFleetAgent` field
  names the fleet agent expected to embody it.
- **Cardinality.** An actor may have zero (operator-only roles like
  `coxswain`, `quartermaster`), one (typical), or several embodiments over
  time. Body identity is not actor identity.

### Layer 3 — Session (ephemeral work-slice)

- **What it is.** A scope-noted, file-claiming presence in a specific
  worktree. Announces "I am working on X right now" and provides the lock
  surface for safe parallel work.
- **Where it lives.** SQLite `sessions` table; in-shell `.portdaddy/current.json`
  for CLI-attached sessions.
- **Lifetime.** TTL-bound and tied to the opening process. Closed by
  `pd done`, salvaged on death, garbage-collected on TTL expiry.
- **What it can do.** Claim files, hold locks, accumulate notes, anchor a
  worktree branch. Sessions cannot receive mail; only actors do.
- **Cardinality.** Many per fleet agent over its lifetime; many per
  single human operator across days; one per active unit of work.

### Composition

```
actor:cartographer            (durable role + mailbox; SQLite forever)
        │
        │ embodied by  (optional, ADR-0022 body lease)
        ▼
fleet/cartographer            (process; restarts/replaces freely)
        │
        │ opens         (1..N over its lifetime)
        ▼
session-roadmap-update-…      (ephemeral; ttl, claims files, lives in worktree)
```

When a fleet agent dies mid-work, its sessions land in salvage. Another
embodiment of the same actor — or a new fleet body, or a human running
`pd salvage claim <agent-id>` — can continue. The actor's mailbox keeps
accumulating regardless.

## Rationale

- Actor identity is a *contract*, not a process. Hard-coupling it to a
  process makes it disappear when the process dies, and makes operator-only
  roles (no live body) impossible to express.
- Sessions are *units of work*, not identities. Coupling them to the actor
  layer would force one actor = one concurrent work item, which doesn't
  match how a single role legitimately spawns multiple parallel sessions
  across worktrees.
- Fleet agents are an *optional embodiment*, not the spine. Some actors
  (`coxswain`, `quartermaster`) are operator/owner contracts with no
  autonomous binary today, and the model has to allow that.
- Keeping the layers explicit lets each one evolve independently:
  the roster grows when a new role is needed, fleet bodies are added when
  the role becomes worth automating, sessions are created on demand as work
  shows up.

## Consequences

### Positive

- Operators have one place to look up the model (this ADR).
- Help text, skill docs, and onboarding can refer to the layers by name
  without inventing new metaphors per surface.
- New actors can be added (canonical roster grows) without committing to a
  fleet binary; new fleet binaries can be added without inventing a new
  actor; new sessions are cheap and don't pollute identity.
- The retired *"maritime actor"* qualifier no longer obscures the fact that
  the same model covers fleet-named (gardener / qa / test-hunter / simplifier)
  and ship-named (coxswain / quartermaster) roles uniformly.

### Negative

- Three layers is one more than the simplest mental model
  ("agent = process"). New contributors need to read this ADR.
- Mailbox routing (Layer 1 ↔ Layer 2) and session salvage (Layer 2 ↔ Layer 3)
  remain the two real coupling points; both have non-trivial code paths
  that have to honor the separation.

### Neutral

- Existing code already follows this split — `lib/actor-roster.ts`,
  `lib/agents.ts` (registry), `lib/sessions.ts` are the three modules. This
  ADR documents the existing reality rather than mandating a refactor.

## Out of scope

- Body lease lifecycle, cooldowns, and authority are owned by ADR-0022.
- Salvage policy and retention are owned by ADR-0019 (declarative fleet YAML)
  and ongoing salvage-envelope work (separate ADR pending).
- Inter-actor messaging protocol details are owned by ADR-0023 (cartographer
  roadmap actor) and the coordination-pipeline-audit code path.

## References

- ADR-0019 — Declarative Fleet YAML
- ADR-0022 — Durable Actor Souls and Body Leases
- ADR-0023 — Cartographer Roadmap Actor
- `lib/actor-roster.ts` — canonical actor records (post PR #52)
- `lib/agents.ts` — fleet-body registry
- `lib/sessions.ts` — session lifecycle
- PR #52 — drop maritime prefix and ghost-actor help fix
