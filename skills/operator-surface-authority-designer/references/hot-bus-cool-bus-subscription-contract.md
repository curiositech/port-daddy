# Hot-Bus / Cool-Bus Subscription Contract

Use this when deciding (or auditing) which message plane a capability's data should ride, or when a `bus-distance-mismatch` finding needs justification beyond "the auditor said so."

## Two planes, never one transport doing both jobs

Chapter 19 promotes the hot-bus/cool-bus split to binder truth:

| Plane | Carries | Transport | Persistence |
| --- | --- | --- | --- |
| Hot bus | presence, current step, stream cursors, steering, pause/cancel intents, small status deltas, high-frequency swarm chatter | one multiplexed loopback WebSocket per surface connection | ephemeral, replaceable, summarized at checkpoints |
| Cool bus | Work Intents, plans, claims, transcript events, control commands, gate decisions, costs, receipts, inbox messages | append-only event ledger, notes, actor inboxes | append-only, replayable, attributable |

The checkpoint rule, verbatim: *hot messages may move the UI quickly; durable events decide history.* A capability's bus subscription is not a performance knob to tune after the fact — it is a statement about whether that capability's data needs to survive a restart and be replayable, or whether it is disposable presence noise that the next tick will overwrite anyway.

## Why intake and deep are pinned to cool

`scripts/surface_authority_audit.mjs` checks `bus-distance-mismatch` only for `intake` and `deep` capabilities, expecting `cool` for both. This is not an arbitrary simplification — it follows directly from the plane table above:

- **Intake (Scout).** Scout's entire job is "turn what the operator is looking at into a Work Intent, with evidence attached." Work Intents are named explicitly as cool-bus objects. A capability whose job is to produce a Work Intent belongs on the cool bus at the capability level, even though Scout also holds a separate hot-bus subscription scoped to its own submission for live status — that liveness feed is a *different* capability (e.g. "own-submission-status"), not the intake action itself.
- **Deep (pd-console).** pd-console's job at this distance is showing daemon truth in full: transcripts, diffs, claims. Transcript events are named explicitly as cool-bus objects, and pd-console is "the only triad surface that renders transcripts in full." A capability whose job is replaying or inspecting that history belongs on the cool bus — even though pd-console *also* subscribes to hot-bus stream frames for an actively-running session, which again is a distinct capability from the deep-inspection one.

## Why ambient is exempt

`ambient` (FleetBar) is deliberately left unchecked by `bus-distance-mismatch`, because chapter 19's own subscription table shows FleetBar legitimately straddling both planes:

| Surface | Hot bus | Cool bus |
| --- | --- | --- |
| Scout | hot-bus topics scoped to its own submissions only | submits Work Intents; reads its intents' status and receipts |
| FleetBar | one multiplexed digest stream: roster states, current steps, pending gates, cost ticks | approval decisions, intent submissions, resume queries |
| pd-console | full per-session stream frames, presence, claims awareness | everything: ledger queries, transcript replay, receipts, search |

FleetBar's roster digest and pending-gate ticks are legitimately hot (ephemeral presence, refreshed continuously); its approval decisions and resume queries are legitimately cool (durable, attributable). Neither is wrong, so a per-capability bus check on `ambient` would produce false positives on correctly-designed capabilities. Treat any spec that tries to force *all* of FleetBar's capabilities onto one plane as a smell worth a manual look, even though the deterministic auditor stays silent on it.

## Interrupt semantics ride both planes on purpose

One deliberate exception worth internalizing before treating "one capability, one plane" as an absolute: an interrupt issued from any surface is *both* a hot-bus intent (so the UI reacts immediately) *and* a durable `ControlCommand` (so the interrupt is undeniable later). This is not a `bus-distance-mismatch` — it's a capability that legitimately needs a foot on each plane, modeled as two capability entries (e.g. `interrupt-fast-path` on `hot`, `interrupt-durable-record` on `cool`) rather than one entry with an ambiguous subscription. When a capability seems to need both, split it; don't force a single `busSubscription` value to mean "both."

## Latency budgets, for context when a mismatch surfaces

Binding for the triad, from the swarm-invocation packet: live board p95 < 250 ms; steering p95 < 100 ms; local IPC hop < 10 ms; loopback WebSocket hop < 25 ms; durable append < 500 ms per checkpoint. Cancel and pause never block on durable append but must emit a durable follow-up once acknowledged. If fixing a `bus-distance-mismatch` finding by moving a capability to `cool` makes it visibly sluggish against these budgets, that is a signal the capability was misclassified as `intake`/`deep` in the first place — split it into a hot presence capability and a cool durable-record capability rather than leaving it on the wrong plane to preserve latency.
