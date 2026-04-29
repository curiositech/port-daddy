# ADR-0027. V4 Remote Harbor: Redefinition

## Status

Proposed

## Context

The V4 roadmap (see `V4-DAG.md` Part XVII, `v4.dag.yaml` lines 376-432) defines "Remote Harbors" as **distributed state replication** between PD daemons:

- Bidirectional WebSocket sync between peers
- HLC (Hybrid Logical Clocks) for ordering
- 5-bucket Merkle hash comparison for diffs
- LWW conflict resolution
- Estimated ~1,500 LOE
- Multiple new failure modes (split brain, conflict storms, clock skew)
- Significant new attack surface (peer compromise reads other peer's full state)

User research (informal, 2026-Q1): when users say "remote harbor," they mean:

1. "My laptop's agent should react to events from my CI runs."
2. "My team should see each other's fleet status in the dashboard."
3. "My agents should coordinate across machines."
4. "I want a single identity across my devices."

Not present: "my SQLite db should replicate to my desktop."

The Relay (ADR-0026) solves (1)-(4) without state replication.

## Decision

**Redefine Remote Harbor as: a harbor whose membership is shared across multiple daemons via out-of-band exchange of the harbor's Ed25519 keypair, with pub/sub coordination across members provided by the PD Relay using harbor-fingerprint namespacing.**

State remains local per daemon. Federation is at the *event* layer, not the *state* layer.

Concretely:
- `pd harbor share` exports a harbor's keypair (passphrase-protected)
- `pd harbor join <import>` imports the keypair into another daemon
- Both daemons derive the same `harbor_fingerprint`
- Both can publish/subscribe to channels `<fingerprint>:<channel>` via the relay
- Sessions, notes, locks, agents stay local to each daemon

Cross-daemon read queries (e.g., dashboard "show all sessions in this harbor across machines") are served by **publishing read-events on a reserved channel** and aggregating responses.

## Non-Goals (deletion from V4 scope)

- Bidirectional state replication
- HLC clocks
- 5-bucket Merkle DB diff
- LWW conflict resolution
- Distributed transaction coordination
- Hinted handoff
- Anti-entropy gossip

These are not forbidden as future work — they are deleted from V4 Remote Harbor scope. If demand justifies, they get their own ADR(s).

## Consequences

**Positive**:
- V4 Remote Harbor ships in weeks instead of quarters
- One transport (relay), one identity primitive (harbor key), one auth model (cards)
- Strong privacy: each daemon controls its own state
- Easy to formally model (no distributed consensus)
- Composes with WoT-exchanged keys for air-gapped scenarios (private relay or no relay)
- Reduced attack surface (no peer-to-peer database access)

**Negative**:
- "Remote harbor" no longer means "single source of truth for harbor data" (this was a mis-feature anyway)
- Users wanting true state replication must wait for a separate ADR / use git
- Some V4 marketing copy needs revision

**Reversibility**:
- This redefinition does not preclude future state-replication ADRs
- Adding state replication later is incremental atop the relay (transport problem already solved)

## Migration

- `V4-DAG.md` Part XVII: rename to "Remote Harbor via Relay Federation"; remove HLC / 5-bucket / LWW sections
- `v4.dag.yaml`: update lines 376-432 to reflect relay-based federation
- `V4-UNIFIED-ROADMAP.md`: one-line update on Remote Harbor scope
- `V4-MASTER-PLAN.md`: remove Part XVII LOE; replace with relay scope reference
- `README.md` V4 Roadmap section: update entry
- New CLI: `pd harbor share`, `pd harbor join`, `pd harbor members`

No code is broken by this redefinition because Part XVII was not built.

## How This Composes

| Capability | How |
|------------|-----|
| Cross-machine pub/sub | Relay + shared harbor fingerprint |
| Cross-machine identity | Ed25519 harbor key shared via `pd harbor share` |
| Cross-machine fleet status | Reserved channel + aggregating dashboard |
| Cross-machine locks (future) | Phase 1: avoid by design (per-daemon scope); Phase 2: lock service over relay |
| Cross-machine session migration (future) | Out of scope; use git / explicit transfer |

## Related ADRs / References

- ADR-0013 (Unified Harbor Model) — the harbor primitive
- ADR-0014 (Anchor Protocol) — the identity primitive
- ADR-0025 (PKI Decision)
- ADR-0026 (Relay Architecture) — the transport
- references/v4-remote-harbor-redefinition.md
- V4-DAG.md, v4.dag.yaml — the documents being amended

## Open Questions

- Should `pd harbor share` use Magic Wormhole for OOB exchange? (Recommendation: yes, optional; manual paste works without)
- Should harbor keypairs auto-rotate on member departure? (Recommendation: yes, with 30-day overlap window)
- How do we name the new CLI verbs to not collide with existing? (Recommendation: prefix all with `pd harbor`)
