# Dependency resolution: contract checks, Kahn trace, and invalidation

This reference expands the entrypoint procedures into a hand-auditable pass. It
works on a declared graph snapshot. It does not edit graph semantics, admit
external effects, or construct a resource schedule.

## 1. Input record and edge typing

Record a graph revision and an explicit direction convention. In this skill,
`producer -> consumer` means the consumer has a prerequisite on the producer.
For each node keep a stable ID and the contracts it provides. For each edge keep
at least:

| Field | Example | What it establishes |
|---|---|---|
| `from`, `to` | `fetch -> parse` | Endpoints in this graph revision |
| `kind` | `artifact-prerequisite` | Why this relation exists |
| `contract` | schema `report-v2`, digest `sha256:…` | The exact output expected by the consumer |
| `predicate` | producer terminal receipt says `success` | What must be true before the consumer is ready |
| `evidenceRef` | immutable graph source / review item | Where the declared relation came from |

Useful edge kinds include artifact/data prerequisite, authority or approval
gate, decision gate, resource exclusion, and soft preference/order. Only
prerequisite-like edges enter Kahn's indegree calculation. Keep the other kinds
visible for the scheduler or admission policy. A test artifact does not satisfy
a production approval; a GPU exclusion does not mean one task semantically
produces another task's input.

Validate the node ID set before traversal: IDs are nonempty and unique; every
edge endpoint resolves in the same graph revision; edge kinds are declared; an
artifact edge names an exact producer output/version/schema and a consumer
completion predicate. Preserve self-edges as errors/witnesses. Do not “repair” a
missing endpoint by inventing a node or dropping the edge.

## 2. Hand-run Kahn's algorithm

Let `P` contain only declared prerequisite edges. Initialize `indegree[v]` to
the number of incoming edges in `P`. Create a queue of every node whose
indegree is zero. Repeatedly remove one ready node, append it to the linear
extension, and decrement the indegree of each of its prerequisite consumers;
enqueue a consumer when its count becomes zero. Record the graph revision and
chosen tie-breaking order. The queue order is one valid linear extension, not an
optimal duration schedule.

To produce synchronous generations rather than a streaming queue, freeze the
current ready set as a generation, remove its members together, and only then
form the next generation. Never call nodes in a ready set “parallel-safe” until
separate capacity, resource, privacy, and effect checks have passed.

**Worked positive.** For `fetch -> parse -> report` and `lookup -> report`, the
initial zero-indegree set is `{fetch, lookup}`. Remove both: `parse` becomes
ready, while `report` still has its `parse` prerequisite. The next generation is
`{parse}`; after removing it, `{report}` is ready. A streaming queue may pop
`fetch` first, decrement `parse` to zero, and queue it while `lookup` is still
waiting. That queue trace can be `[lookup, parse]`; it is not the same output as
the generation partition, even though both yield valid orders.

For a resource case, if `analyze-A` and `analyze-B` both declare exclusive use
of one GPU, the dependency result can mark both ready. The resource policy must
hold/admit them according to capacity. Do not mutate the semantic DAG by adding
`analyze-A -> analyze-B` unless the task contract itself requires that order.
If a chosen scheduler records an ephemeral reservation order, label it as such
and keep it outside the prerequisite graph.

### Restoring the original ten-node example safely

The original fixture declares these prerequisite chains:

| Producer / prerequisite | Consumer |
|---|---|
| `load-data` | `validate-data` |
| `validate-data` | `clean-data` |
| `clean-data` | `analyze-A`, `analyze-B` |
| `analyze-A`, `summarize` | `transform-A` |
| `transform-A` | `summarize` |
| `analyze-B` | `transform-B` |
| `transform-A`, `transform-B` | `report` |
| `report` | `cleanup` |

`transform-A <-> summarize` is a directed cycle, so no topological order exists
for the original declarations. Preserve the exact two-edge witness and stop
there. The original suggested edge rewrite (“replace `transform-A -> summarize`
with `analyze-A -> summarize`”) is only one candidate semantic revision. It is
valid only if the task owner confirms that `summarize` consumes `analyze-A` and
does not consume `transform-A`; record the new graph revision and contract
before recalculating. Under that hypothetical revision, Kahn generations are:

| Generation | Ready nodes after all earlier generations complete |
|---|---|
| 0 | `load-data` |
| 1 | `validate-data` |
| 2 | `clean-data` |
| 3 | `analyze-A`, `analyze-B` |
| 4 | `summarize`, `transform-B` |
| 5 | `transform-A` |
| 6 | `report` |
| 7 | `cleanup` |

This is a generation partition of the hypothetical prerequisite graph, not an
execution plan. Both analyze nodes declare GPU use; the scheduler must enforce
GPU capacity before admitting concurrent work. `clean-data` and `transform-B`
name a memory pool but are in different generations under the synchronous
partition; if a resource reservation outlives a node's completion, model that
lifetime in the separate resource policy. Likewise `load-data` and `cleanup`
share a database label but are not automatically conflicting if their exclusive
reservation lifetimes do not overlap. Never infer resource safety solely from
the resource name or wave number.

## 3. Residual graph and semantic repair

If Kahn emits fewer than all nodes, the remaining nodes have positive indegree
within the residual relation. Return the residual node/edge set and a concrete
cycle witness from a strongly connected component (or another valid witness
algorithm). For example:

`transform-A` declares `summarize` as a prerequisite, and `summarize` declares `transform-A` as a prerequisite.

Both nodes remain after Kahn. The witness identifies a contradiction in the
declared prerequisite relation. Ask the named graph owner which contract is
wrong, stale, conditional, or missing. A resolver may present candidate
edits with their consequences; it must not merge nodes, remove a self-edge,
drop an edge to obtain an order, insert a buffer, or add a serialization edge
on its own. If a condition changes whether an edge exists, represent the
condition and its selected graph revision explicitly, then validate that
revision; do not call a default branch proof of all possible branches.

## 4. Resource conflicts and authority remain separate

For every ready node, pass separate inputs to downstream scheduling/admission:
required resources and exclusivity, current capacity/reservations, precedence or
fairness policy, authority principal/scope, data class, and required approval
receipt. A conflict may yield “hold,” a bounded queue, or a policy-chosen order;
this resolver does not choose among them. Keep an authorization edge/gate
separate from an artifact's completion receipt. No topological order certifies
that an external effect is permitted or has happened.

## 5. Incremental invalidation on changed inputs

When producer `P` publishes a new graph/output revision, compare each direct
consumer's recorded input binding `(producer ID, digest, schema/version,
completion predicate)` with the new binding. Mark a consumer stale only when a
binding it actually consumed changed or its contract must be revalidated. Walk
forward through the producer-to-consumer closure, rechecking each downstream
node's declared input bindings and propagating invalidation to the next consumer
whose input version changed. Stop at consumers whose consumed inputs and
contract checks remain valid. Record the old and new graph revision, changed
output identities, affected consumer IDs, and the first unchanged boundary.

This is dependency invalidation, not automatic graph mutation, cancellation, or
re-execution. It does not create/delete resource edges, infer a dependency from
co-occurrence, or authorize replay. A downstream execution system decides what
to restart after it separately checks active attempts and effects.

**Hand check.** `source-v1 -> normalize-v1 -> report-v1`; `catalog -> report-v1`.
If only `source` changes to v2 and `normalize` emits a changed digest, mark
`normalize` stale, re-evaluate the `normalize -> report` input binding, and mark
`report` stale if it consumed the old normalized digest. `catalog` remains a
current input. If `normalize` re-runs but emits a byte-identical digest under
the same schema and the consumer's declared contract treats that digest as
identity, report that exact equality and still perform any required contract
validation; do not generalize it to “semantic equality.”

## Evidence and limits

Bazel's pinned [Skyframe reference](https://bazel.googlesource.com/bazel/%2B/3b9ed6e9d3570a0c67e0d59e65b3785bbc1fad99/site/en/reference/skyframe.md)
describes incremental reverse-dependency invalidation in a build graph. Bazel's
[query documentation](https://docs.bazel.build/versions/main/query.html) covers
graph ordering and notes that cycle handling is unspecified. These sources
support graph/order and invalidation concepts; they do not establish agent-work
authority, resource-scheduling correctness, or external-effect safety.
