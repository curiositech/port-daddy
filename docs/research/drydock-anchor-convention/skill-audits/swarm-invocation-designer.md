# Skill audit — `swarm-invocation-designer`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

Structural validation passes, but semantic readiness is **5.4/10**. The bundle
is compact and legible, yet it optimizes transport latency before defining the
authority, capacity, lifecycle, fan-in, reduction, review, and replay contracts
needed for a safe invocation. Its only executable analyzer can return a false
green for data that violates its own schema.

| Dimension | Score / 10 | Finding |
|---|---:|---|
| Frontmatter | 7 | Valid What/When/NOT shape, but scope overlaps topology, conversation protocol, and IPC expertise; tools are over-privileged. |
| Progressive disclosure | 8 | 165-line entrypoint and compact references; README and changelog are prose-orphans and README eagerly loads references. |
| Anti-patterns | 4 | Only three transport-oriented patterns; no recursive-birth, split-admission, capacity, fencing, gather, replay, or bounded-rework failures. |
| Visual artifacts | 4 | One valid generic sequence diagram; no admission lifecycle, cancellation/fencing, or gather/reducer state model. |
| Shibboleths | 4 | Good hot/durable split; missing controller-only admission, conserved global capacity, generation fences, deterministic reducers, and topology honesty. |
| Self-containment | 5 | No schema or validator for the declared primary deliverable; latency analyzer accepts malformed input. |
| Activation | 6 | Correct on 5/6 positive and 3/6 negative manual routing cases; overlaps three neighboring skills. |

## P0 findings

### P0-1 — Admission authority and birth prohibition are undefined

The diagram names a generic Control Plane but never makes it the sole admission
writer. “Lead agent owns the merge” leaves execution authority ambiguous. No
bundle file prohibits recursive births or removes spawn authority from workers.

**Required repair:** one external controller admits, retries, and launches;
agents may propose but cannot mint executable work; `maxRecursiveBirths = 0`.

### P0-2 — Capacity, leases, fencing, and cancellation are not conserved

The bundle records per-role budgets but no atomic global reservation. Cancel is
a message name, not a generation-bound state transition with idempotency,
acknowledgement deadline, external fence, forced termination, and settlement.

### P0-3 — Typed gather, deterministic reduction, and replay are absent

The skill claims replayability but defines neither event schema nor reducer.
Parallel outputs can be omitted, duplicated, reordered, or reduced differently
after recovery without detection.

### P0-4 — The shipped analyzer has a demonstrated false green

An adversarial input violated four requirements in
`latency-budget.schema.json`:

- string instead of numeric `targetP95Ms`;
- unknown channel role;
- missing channel name and transport; and
- `maxBytes: 0` despite minimum 1.

`latency_budget.mjs` exited zero with `pass: true`. It coerces numeric strings,
checks only part of each channel, silently excludes unknown roles, permits zero
bytes, and never loads the schema.

## P1 findings

1. Review and rework lack independent roles, verdict schema, attempt limit,
   rework-round limit, and aggregate review-capacity ceiling.
2. Planning topology can be presented as runtime topology. Every invocation
   needs `planningTopology`, `runtimeTopology`, `supportStatus`, projection
   rules, and operator acceptance when they differ.
3. Sparse typed messaging is not enforceable. Authoritative messages need
   invocation, plan, node, run, sender, generation, fence, sequence, causation,
   idempotency, expiry, and artifact-handle fields. Invocation intent is durable,
   never hot-path ephemera.
4. Activation collides with `agent-conversation-protocols`,
   `ipc-communication-patterns`, and `coordination-topology-architect`.

## Required bundle replacement

- Narrow the description to controller-owned invocation and execution
  governance. Explicitly exclude generic IPC choice, standalone conversation
  protocols, topology selection, and live operation.
- Replace the core diagram and procedure with: sealed intent → exact supported
  topology → closed plan → controller admission → atomic reservations → fenced
  leases → typed execution → exact gather → versioned deterministic reducer →
  bounded independent review/rework → cancellation/settlement → replay.
- Add references for authority/lifecycle, typed graphs/reducers, and
  messages/replay.
- Treat lead, tournament, relay, and watcher as planning archetypes only.
- Move ICP/IPC and indicative transport latency to a subordinate appendix.

## Minimum executable bundle

1. `schemas/swarm-invocation.schema.json`, closed by default, requiring one
   external admission owner, global limits, typed nodes/edges/gathers/reducers,
   capacity reservations, lease policy, messages, review, topology, and replay.
2. The [swarm invocation validator](../../../../skills/swarm-invocation-designer/scripts/validate-swarm-invocation.mjs), which validates schema first and
   then authority, acyclicity, wave capacity, generation fences, cancellation,
   gather membership, reducer determinism, bounded review, replay convergence,
   and topology projection.
3. One passing fan-out/gather/reduce/review fixture.
4. A mutation corpus covering worker spawn authority, recursive birth, global
   overcommit, stale fence, missing cancel deadline, gather drift, nondeterministic
   reducer, third rework round, replay mismatch, omitted runtime topology, and
   oversized hot messages.
5. Six positive and six negative activation cases.

## Activation repair

Positive cases include controller-owned admission, fixed zero-child execution,
typed gather/reduction, capacity/fencing audit, honest topology projection, and
bounded review. Negative cases include operating live agents, a single-agent
prompt, CRDT editor choice, FIPA dialogue design, topology selection, and raw
Unix-socket-versus-gRPC choice.

## Change recommendation

Supplant the current primary contract in one slice. Do not keep the latency
calculator as an alternative validator. It may survive only as a nested,
schema-checked diagnostic after the invocation contract passes.
