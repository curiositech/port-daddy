# Changelog

## 2.0.0 — 2026-09-16

### Breaking

- Replaced transport-first, lead-owned prompt fanout with controller-owned
  admission and lifecycle contracts.
- Deleted the latency budget schema/analyzer and all 1.x templates; no legacy
  or downgrade path remains.
- Made reservation, fencing, durable intent, gather membership, bounded rework,
  terminal settlement, and effect-denied replay mandatory.
- Narrowed activation away from IPC selection, planning decomposition, dialogue,
  and live operation.
