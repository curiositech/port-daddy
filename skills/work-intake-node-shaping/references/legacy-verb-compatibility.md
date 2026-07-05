# Legacy Verb Compatibility

Use this when auditing a `spawn`/`dispatch`/`sortie`/`conjure`/`nightshift` code path, or when
reviewing a control-plane PR that adds a new launch entrypoint under an old name.

Source: `docs/architecture/agent-harbor-technical-binder/work-packets/official-agent-control-plane-synthesis.md`,
"Single Operator Action":

| Old word | Target meaning |
| --- | --- |
| `spawn` | compatibility launch entrypoint for a WorkIntent with adapter preference |
| `dispatch` | queued/background WorkIntent source |
| `sortie` | mission/workgroup recipe source |
| `conjure` | interactive WorkIntent drafting flow |
| `nightshift` | scheduled or background WorkIntent source |

`agent`/`agents` is a registry/heartbeat/stream/inbox/control concept, not a launch verb, and is
out of scope for this audit.

## The rule

Every one of the five verbs above is **compatibility source metadata** describing *how* a
WorkIntent arrived, not a second decision point about *what* topology to launch. Each one must
terminate in the same daemon primitive:

```text
Capture a WorkIntent, shape a WorkPlan, materialize AgentNodes only when the plan is
governable, attach Bodies through adapters, persist TranscriptEvents, authorize controls
through the daemon, and seal a WorkReceipt.
```

A legacy verb is safe exactly when it annotates the WorkIntent (e.g. `{ sourceVerb: "sortie" }`)
and then calls the same `materialize-one-Agent-Node` path every other entrypoint uses. It is
unsafe the moment it independently:

- opens its own session id before the shared pipeline runs,
- starts its own transcript stream,
- or materializes an Agent Node that never goes through the daemon's governability check.

## Why this matters: the Official-Agent Definition

The binder's "Official-Agent Definition" lists minimum predicates every official Agent Node
must satisfy — including that "Agent Node exists before the first model turn," "Session,
worktree/sandbox, transcript id, and retention policy are non-null before official work
starts," and "Transcript events are append-only, sequenced, hash-linked ... and replayable." A
legacy verb that writes independent state is not just redundant plumbing — it produces a
second Agent Node that never passed through those predicates, which is exactly the
`observed` / `run-log` / `transcripted-weak` degraded modes the binder defines as non-official.
An operator who thinks they launched one governed unit of work has actually launched one
governed node and one ungoverned shadow.

## Auditing a route

For each legacy verb reachable from a WorkIntent's entrypoint, record:

```json
{ "verb": "sortie", "writesIndependentState": false }
```

`writesIndependentState` must be proven `false` — traced to the actual call site, not assumed
because the verb "looks like" a thin wrapper. `scripts/node_shaping_audit.mjs` fails closed:
`true` on any route is always a critical finding, and a verb outside the five documented names
is flagged (medium) as a possible naming drift worth confirming.
