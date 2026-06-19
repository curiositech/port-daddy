# 0022. Durable Actor Souls and Body Leases

## Status

Accepted

## Context

Port Daddy historically used one `agents` row for too many meanings:
durable identity, live process, inbox target, lock authority, salvage subject,
and operator-visible history. That made agent-row deletion valuable for cleanup,
but dangerous for memory: deleting the row also made useful history and mailbox
identity disappear.

Simply preserving every agent row is not safe. Stale processes must not keep
authority to mutate sessions, locks, claims, IPC channels, or salvage state just
because their historical identity still exists.

## Decision

Separate durable actor identity from live execution authority:

- **Actor soul:** stable identity, archetype, mailbox, belief/history state, and
  operator-visible addressability.
- **Body lease:** live incarnation with heartbeat, PID/process or transport
  attachment, generation, and authority to perform protected actions.

`/agents` remains the live-body compatibility view while `/actors` becomes the
additive durable identity surface.

## Rationale

This keeps history valuable without making stale runtime state powerful. It also
fits the virtual actor direction: projects, fleets, agents, harbors, sorties,
and trigger keys can all own mailboxes while activation policy stays centralized
around leases, cooldowns, dedupe, backoff, and budget gates.

## Consequences

### Positive

- Actor history and inboxes can survive process completion.
- Salvage becomes lease recovery or adoption, not resurrection of a deleted
  identity.
- FleetBar and Fleet Control Center can distinguish durable actors from live
  bodies.
- Lock/file/session authority can move to lease-aware checks without losing
  durable attribution.

### Negative

- Migration is multi-step because cleanup, Arbiter checks, IPC auth, and
  salvage currently rely on `agents` row lifecycle.
- UI counts can become misleading if historic leases are shown as live agents.
- Dormant actor mailboxes need quota and retention policy.

### Neutral

- The first `/actors` surface is a read-only directory/projection. It does not
  change `pd done`, stale cleanup, lock ownership, or IPC authorization yet.

## Implementation Notes

Lease states should become explicit before cleanup semantics change:

- `attached`
- `draining`
- `detached`
- `dead`
- `revoked`

Protected operations should eventually require a live lease or delegated token,
not mere actor existence. Durable actor existence is for identity, mailbox,
history, and attribution.
