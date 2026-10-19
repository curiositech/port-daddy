---
name: agent-context-partitioner
description: >-
  Designs and audits deterministic, authority-filtered partitions of trust-typed context for already admitted bodies or abstract continuation slots. Use when causal context, obligations, disclosure boundaries, vector-space identity, capacity, and omission proofs must survive partitioning. NOT for spawning or admitting agents, choosing worker count, retrieving arbitrary knowledge, writing successor prompts, or granting tools, leases, identity, or effect authority.
license: Apache-2.0
allowed-tools: Read,Grep,Glob
metadata:
  version: "2.0.0"
  category: Agent & Orchestration
  tags: [context, partitioning, authority, causality, continuation, vector-space]
  io-contract:
    kind: structured
    produces:
      - kind: context-partition-proposal-v2
        format: json
        schema: schemas/context-partition-proposal-v2.schema.json
---

# Agent Context Partitioner

Partition only after authority, disclosure, causality, capability, and capacity are explicit. Optimization may choose among feasible assignments; it may never repair an infeasible one or create a new body.

## Activate when

- a sealed Context IR must be assigned across admitted bodies;
- a continuation package needs abstract destination requirements without launching a successor;
- open obligations and unresolved effects must be proven present;
- vector-based cohesion must respect immutable embedding-space identity;
- omissions, transfers, and capacity use need a machine-checkable proof.

## Do not activate for

- “spawn more agents,” worker-count selection, or capacity admission;
- identity continuity, process resurrection, or credential transfer;
- general RAG, clustering, prompt writing, or memory retrieval;
- lifecycle fencing, effect reconciliation, capability minting, or lease creation;
- estimating provider quota or subscription usage.

## Modes

- `ACTIVE_SET_PARTITION` targets exact admitted bodies supplied by another authority.
- `CONTINUATION_REQUIREMENTS` targets abstract slots carrying required capabilities and capacity only. A slot has no process, provider session, credential, lease, or identity.

Outputs are `FEASIBLE`, `INFEASIBLE`, or `UNKNOWN`. Never emit `READY`, `AUTHORIZED`, `ADMITTED`, or `SPAWN`.

## Hard order of operations

```mermaid
flowchart TD
  A[Sealed trust-typed Context IR] --> B[Verify source root and policy]
  B --> C[Filter targets by tenant, disclosure, audience, and current guidance]
  C --> D[Close causal parents, obligations, unresolved effects, and capabilities]
  D --> E[Check singleton and aggregate capacity]
  E -->|Any hard gap| F[INFEASIBLE or UNKNOWN with exact gap]
  E -->|Feasible set| G[Apply deterministic baseline objective]
  G --> H[Emit assignments, typed transfers, omissions, and coverage proof]
  H --> I[Validate proposal against original root]
  I --> J[PrepareContinuation input only]
  J -. separate lifecycle authority .-> K[AdmitSuccessor]
```

1. **Bind the root.** Record source snapshot, content digest, policy digest, and complete item inventory.
2. **Separate guidance from evidence.** Only current, audience-matching, revocation-checked guidance may enter a directive channel. Facts and history remain cited data.
3. **Filter before scoring.** Tenant, harbor, repository, disclosure, retention, and capability rules define the feasible set.
4. **Close dependencies.** Every causal parent, open obligation, unresolved effect, and non-droppable item is assigned, transferred through an authorized edge, or blocks the plan.
5. **Respect capacity.** Oversized singleton items and aggregate target overflow are hard failures.
6. **Choose a deterministic candidate.** The optional feasibility helper orders items topologically, then prefers a compatible target already holding causal parents, lower projected capacity use, and target ID. It is a greedy proposal aid, not an optimal partitioner; semantic cohesion remains disabled unless all compared items share one exact `spaceId`.
7. **Prove coverage.** Every input item receives one inventory disposition: `ASSIGNED`, `TRANSFERRED`, `OMITTED_ALLOWED`, or `BLOCKED`.

## Context IR invariants

- Only `CURRENT_GUIDANCE` with current envelope, audience, scope, verification, and revocation evidence may be directive.
- Primary evidence, cited derivations, historical intent, and untrusted content remain data.
- Open obligations, unresolved effects, lineage, and causal parents are non-droppable.
- Summaries and compactions cannot become primary roots.
- Missing authority, provenance, or revocation evidence yields `UNKNOWN`, never a permissive guess.
- A tombstone may replace deleted content, but derived vectors and projections must identify the invalidated source revision.

## Retrieval-space identity

A vector-bearing item binds model artifact/config, preprocessing, chunker, pooling, dimensions, normalization, metric, coordinate precision, quantization, redaction policy, modality, and derived `spaceId`. Provider name and transport are provenance, not compatibility.

- Compare vectors only when `spaceId` is identical.
- Equal dimensions are insufficient.
- Mismatch disables the semantic objective; it does not authorize full-copy fallback.
- Re-embedding creates a new item revision and separately receipted migration.

See [`references/retrieval-space-identity.md`](references/retrieval-space-identity.md) for the exact digest recipe.

## Coverage and omission

Allowed omissions are limited to `OUT_OF_SCOPE`, `RETENTION_REDACTED_WITH_TOMBSTONE`, `EXPIRED_DISPOSABLE`, `DUPLICATE_CONTENT_HASH`, and `SUPERSEDED_PROJECTION`. `DESTINATION_INCOMPATIBLE`, `UNKNOWN_SOURCE`, and `SIZE_EXCEEDED` are blocking gaps.

Coverage proves completeness only relative to the supplied root and obligation set. It cannot prove the root discovered every relevant fact.

## Prepare is not admit

The proposal may feed `PrepareContinuation`. It does not fence a predecessor, reconcile an effect, reserve capacity, mint a capability, select a process, consume a nonce, or create lineage. A lifecycle authority may later run `AdmitSuccessor` only after independent fence, effect, capacity, guidance, and context receipts.

## Deterministic feasibility helper

[`algorithms/partition_feasibility.py`](algorithms/partition_feasibility.py)
answers a narrower question than the proposal validator: whether supplied items fit
supplied, already-admitted targets under stated capacities, audiences, capabilities,
and causal parents. It returns `UNKNOWN` for incomplete inventory evidence and
`INFEASIBLE` for a known constraint gap. Its greedy choice is reproducible, but it
does not prove global optimality, authorize a disclosure transfer, discover missing
context, or create a successor. Load
[`references/partition-procedure.md`](references/partition-procedure.md) for the
algorithm and its worked limitation.

The diagrams show the two non-negotiable boundaries:
[feasibility before choice](diagrams/01_feasibility-gate.md) and
[evidence for cross-target transfer](diagrams/02_cross-target-transfer.md).

## Anti-patterns

### Optimize, then filter

**Wrong:** cluster first and remove forbidden assignments later.

**Right:** authority and disclosure define the feasible graph before any score exists.

### Same dimensions, same space

**Wrong:** compare two 768-dimensional vectors.

**Right:** require identical immutable `spaceId`.

### K proposal means birth

**Wrong:** turn a capacity gap into “spawn another worker.”

**Right:** emit the exact missing capability or capacity with no lifecycle action.

### Summary becomes source

**Wrong:** repartition yesterday's summary.

**Right:** regenerate from primary roots and use summaries only to test omissions.

## Output and validation

- [`schemas/context-partition-proposal-v2.schema.json`](schemas/context-partition-proposal-v2.schema.json) — closed contract.
- [`examples/valid-proposal.json`](examples/valid-proposal.json) — canonical no-vector fixture.
- [`scripts/validate-context-partition.mjs`](scripts/validate-context-partition.mjs) — semantic validator and digest recomputation.
- [`scripts/test-bundle.mjs`](scripts/test-bundle.mjs) — positive plus adversarial mutations.
- [`references/context-ir-and-continuation.md`](references/context-ir-and-continuation.md) — field semantics and lifecycle boundary.
- [`references/partition-procedure.md`](references/partition-procedure.md) — supplied-inventory greedy procedure and limits.
- [`algorithms/partition_feasibility.py`](algorithms/partition_feasibility.py) — deterministic proposal-only helper.
- [`tests/activation.md`](tests/activation.md) — activation corpus.

```bash
node skills/agent-context-partitioner/scripts/validate-context-partition.mjs \
  skills/agent-context-partitioner/examples/valid-proposal.json
node skills/agent-context-partitioner/scripts/test-bundle.mjs
```

Static validity is not optimality, complete discovery, safe execution, or successor admission.
