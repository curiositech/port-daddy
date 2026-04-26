# V4 Remote Harbor: Redefinition

**Load when**: writing ADR-0023 (V4 Remote Harbor Redefinition); arguing against Part XVII scope.

## TL;DR

The V4 roadmap's "Remote Harbors" was originally scoped as **distributed state replication** between PD daemons (Part XVII: WebSocket bidirectional sync, HLC clocks, 5-bucket Merkle, LWW conflict resolution — ~1,500 LOE). We are **redefining Remote Harbor** as **shared harbor keypair + relay namespace**: federation of *messages* (pub/sub via the relay), not federation of *state*.

This ships the user-visible win ("my fleet sees my CI's events") at ~5% of the cost.

## What users actually want from "remote harbor"

Empirically, when users say "remote harbor" they mean one of:

1. **"My laptop's agent should react to events from my CI runs."** Pub/sub federation. No state sync needed.
2. **"My team should see each other's fleet in the dashboard."** Read federation of fleet status. Optional, second priority.
3. **"My agents should coordinate across machines."** Pub/sub + locks. The pub/sub is the relay; the locks are a second feature (out of scope for relay v0).
4. **"I want a single identity across my devices."** Identity federation, not state. Solvable via WoT-exchanged harbor keys.

Notably absent: "my SQLite db should replicate to my desktop." That's a niche feature being mistaken for the user-facing demand.

## What Part XVII proposed

From `V4-DAG.md` Part XVII and `v4.dag.yaml` lines 376-432:

- Bidirectional WebSocket sync between daemons (peer-to-peer)
- HLC (Hybrid Logical Clocks) for ordering
- 5-bucket Merkle hash comparison for diffing
- LWW conflict resolution
- ~1,500 lines of estimated effort
- Multiple new failure modes (split brain, conflict storms, clock skew)
- New attack surface (peer compromise reads other peer's state)

## Why Part XVII is wrong scope

1. **Solves the wrong problem.** Users want federated *events*, not federated *databases*.
2. **Extreme complexity.** Distributed sync is one of the hardest problems in CS; getting it wrong loses data.
3. **Multiplies attack surface.** Every peer becomes an authentication boundary.
4. **Couples liveness.** A flaky peer slows healthy peers (without sophisticated hinted handoff).
5. **Doesn't compose with the relay.** The relay solves federation by being a hub; peer-to-peer state sync is a parallel mechanism with overlapping concerns.

## What we redefine to

> **Remote Harbor (V4)**: A harbor whose membership is shared across multiple daemons, where shared membership is established by out-of-band exchange of the harbor's Ed25519 keypair, and pub/sub coordination across members is provided by the PD Relay using harbor-fingerprint namespacing.

Concretely:
- `pd harbor share` exports a harbor's keypair (with a passphrase)
- `pd harbor join <import>` imports the keypair into another daemon's local store
- Both daemons now share the harbor fingerprint
- Both can publish/subscribe to channels under that fingerprint via the relay
- State (sessions, notes, locks, agents) remains local to each daemon

State queries across daemons (e.g., "show me all in-flight sessions in this harbor across machines") are answered by **publishing read-events on a reserved channel** and aggregating responses. This is enough for dashboard purposes.

## What this loses vs Part XVII

- **No automatic state replication.** If you delete a session on machine A, it still exists on machine B.
- **No automatic conflict resolution.** Concurrent claims of the same port on different machines remain — but they were never coordinated anyway, so no regression.
- **No "single source of truth" for harbor data.** That's a feature (privacy) not a loss.

If we ever want true state replication, we add it as a **separate** feature with its own ADR, atop the relay (not instead of). It's much smaller atop the relay since the transport problem is solved.

## What this gains over Part XVII

- **Ships in weeks, not quarters.**
- **One transport (relay), one identity primitive (harbor key), one auth model (cards).**
- **Strong privacy: each daemon controls its own state.**
- **Easy to formally model (no distributed consensus).**
- **Composes with WoT-exchanged keys for air-gapped scenarios** (use a private relay or no relay).

## Migration in roadmap docs

`V4-DAG.md` and `v4.dag.yaml` need:
- Part XVII renamed/replaced with "Remote Harbor via Relay Federation"
- Reference to ADR-0023
- Removed: HLC, 5-bucket Merkle, LWW conflict resolution
- Added: shared keypair UX, relay namespace mapping

`README.md` V4 Roadmap section needs a one-line update to point at the new scope.

## What about people who actually want state sync?

Three options, in order:

1. **Don't.** Tell them to use the relay for events; keep state local. Most are convinced.
2. **Use git.** Commit notes / sessions / configs to a repo; pull on another machine. Solves the use case for many.
3. **Wait for v1.** State sync atop the relay is a coherent v1 ADR. We aren't blocking it forever; we're not blocking the relay on it.

## Anti-patterns

- **"We need state sync to be 'really' remote."** No. Federation of *events* is the lowercase-r remote. State sync is a separate v1+ ask.
- **"Phantom Part XVII references."** Search and remove from docs/, V4-DAG.md, plans/, recovery/.
- **"Sneak in HLC for 'just' fleet status."** No HLC. Period.
- **"Conflate 'remote harbor' with 'multi-tenant relay'."** Different concerns. Multi-tenant relay = separate harbors share infrastructure. Remote harbor = same harbor on multiple daemons.

## ADR template

Use `templates/ADR-V4-Remote-Harbor-Redefinition.md`. Required sections:
- Status: Proposed
- Context: Part XVII over-scope problem
- Decision: redefine as relay federation
- Consequences: state stays local; pub/sub federates; reduced complexity; explicit non-goals
- Migration: doc/code references to update
- Related: ADR-0013 (Unified Harbor), ADR-0014 (Anchor Protocol), ADR-0019 (Fleet YAML), ADR-0021 (PKI Decision), ADR-0022 (Relay Architecture)

## Open question

**How do we communicate this without sounding like we're cutting features?** Honest framing: we're sharpening the definition. Pub/sub federation is what people want; state sync is a niche we'll add later if there's demand. Don't oversell, don't undersell.

## Reading list

- `V4-DAG.md` Part XVII (the thing we're deleting/redefining)
- `v4.dag.yaml` lines 376-432
- `V4-UNIFIED-ROADMAP.md` (needs update)
- `V4-MASTER-PLAN.md` (needs update)
- ADR-0013 (Unified Harbor Model)
- `relay-architecture.md` (the new substrate)
