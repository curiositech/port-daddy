---
title: "Decision tree: something broke"
purpose: "Diagnose selected-runtime and coordination truth before mutating anything."
last_verified: 2026-08-04
---

# Something broke

```text
START: an observed surface failed
│
├─ Re-anchor: pd attention, sitrep, briefing, sessions, notes; git fetch origin
│  └─ If current work already explains it, join or coordinate instead of duplicating
│
├─ Which daemon did the failing client select?
│  ├─ unknown/ambiguous → stop mutations; resolve profile label and published endpoint
│  └─ known             → compare health identity, source revision, PID, and heartbeat
│
├─ Does socket evidence disagree with published TCP evidence?
│  ├─ YES → report each transport separately; never guess a loopback port
│  └─ NO  → continue
│
├─ Stable selected?
│  ├─ YES → Homebrew/launchd is the only lifecycle owner
│  └─ NO  → `pd dev` owns the named feature daemon; stable is unrelated
│
├─ Is the symptom a broad native-module ABI cascade?
│  ├─ YES → verify Node ABI and reinstall/rebuild dependencies for this worktree
│  └─ NO  → keep the failure scoped to the actual surface
│
├─ Did Coordination Guard refuse the mutation?
│  ├─ wrong/no context → name the intended session/agent explicitly
│  ├─ missing claim    → claim the smallest real surface
│  └─ another owner    → coordinate or salvage; do not override silently
│
└─ Still broken after bounded evidence?
   → publish exact repro and evidence to coordination:inconsistency, then fix
     locally only if the fault remains bounded and unowned
```

## Evidence rules

- PID alone is not liveness; require a positive PID and fresh supervisor or
  provider heartbeat.
- A missing process is not proof of failure; reconcile the durable receipt and
  transcript, then report `unknown` or `no_runtime` when appropriate.
- A missing route in an old installed daemon is not proof the source feature is
  absent. Compare exact serving revision.
- An occupied preferred bind seed is not an outage. Correct clients follow the
  published endpoint chosen by the binder.
- Restart only through the lifecycle owner for the selected runtime. Never add
  a second watchdog or let a foreign checkout restart stable.

See `references/error-codes-and-recovery.md` for literal errors and
`examples/06-debug-daemon-down.md` for an evidence-first worked example.
