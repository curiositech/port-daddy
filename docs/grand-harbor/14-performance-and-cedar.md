# Lightning-fast paths and the Cedar candidate

**Status:** PERFORMANCE DESIGN CANDIDATE  
**Decision:** no policy engine selected  
**Measurement:** Port Daddy latency targets are unbenchmarked until a repository benchmark says otherwise

Yes: explicit state machines afford several genuinely lightning-fast operations. Cedar could make the authorization predicate portion fast too. Neither makes model interpretation, network effects, provider accounting, or external observation instant.

## What becomes fast immediately

| Operation | Synchronous truthful result | Later work |
|---|---|---|
| Capture instruction | append `Captured` with ID/sequence | semantic interpretation proposal |
| Validate lifecycle edge | allow/deny by table lookup | policy or operator judgment when required |
| Update projection | incrementally apply canonical event | remote hydration/rebuild verification |
| Request claim | append/request ID and show overlaps | conflict policy/negotiation |
| Submit action | immutable ActionIntent ID | authorization evaluation |
| Authorize action | permit persisted at exact versions | actuator execution and observation |
| Lose body | mark suspected/lost under deterministic criteria | replacement selection and reconciliation |
| Emit pheromone | provenance-bearing bounded signal | decay/diffusion/routing influence |
| Revoke grant | local revocation-requested event | remote receipt and in-flight resolution |

The UI can be instant about `captured`, `requested`, `denied`, `permitted`, and `revocation issued`. It must not become “fast” by relabeling those states as interpreted, executed, proved, or revoked everywhere.

## Recommended responsibility split

```text
Rust lifecycle FSM      legal state edge
Cedar candidate         who may request which typed effect under context
Harbor database         authoritative facts and versioned entity projection
DB transaction/CAS      atomic permit issue/consume and outbox write
Actuator                real effect with protected credential
Receipt/evidence        what happened and what remains unknown
```

Cedar does **not** authenticate the actor, store or transition workflows, mint/consume permits, own secrets, perform effects, guarantee exactly-once delivery, revoke an issued permit automatically, produce obligations, or verify receipts.

## Candidate hot path

```mermaid
flowchart LR
    I["Typed ActionIntent"] --> F["Legal FSM edge"]
    F --> S["Versioned auth snapshot"]
    S --> C["Cedar is_authorized"]
    C --> X["CAS exact versions"]
    X --> P["Persist permit + outbox"]
```

Evaluation can occur outside the transaction. The short transaction compares resource, policy, schema, and relevant entity versions; inserts the bound permit/outbox; and commits. A compare failure retries from a fresh snapshot.

## Cedar performance evidence, stated narrowly

The [Cedar OOPSLA paper](https://arxiv.org/pdf/2403.04651) reports in-memory core evaluation measurements. It explicitly excludes entity initialization, policy parsing, HTTP, and storage. Its reported workloads include median evaluation around 4–5 microseconds for a Google-Drive-like workload as entity counts rise and around 11 microseconds for a GitHub-like workload, with reported p99s below roughly 10 and 20 microseconds respectively. Those figures support Cedar as a plausible fast evaluator; they are not Port Daddy end-to-end measurements.

The keystone comment proposed p50 under 100 microseconds and p99 under 1 millisecond for the Port Daddy authorization path. This ledger records them only as **unbenchmarked targets**.

AWS's [Lean report](https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development/) separates small evaluator measurements (reported around 5 microseconds in the model and 7 microseconds in Rust) from an approximately 185-second whole proof/model compilation. It is wrong to describe that as “Lean proves every action in five microseconds.”

## Cedar integration rules if selected

1. Embed the Rust evaluator directly first; keep parsed policy sets and schema warm by exact epoch.
2. Model business/effect actions such as `UpdatePullRequestBody`, `WriteFile`, `SpawnProcess`, and `DelegateGrant`, not internal bookkeeping edges.
3. Validate schema/policies offline and in deployment gates; normalize input before evaluation.
4. Populate policy scopes so indexing works; provide the smallest versioned entity slice.
5. Keep mutable time, lease, budget, and observed substrate facts in explicit context/entities rather than environment magic.
6. Cedar uses default deny and `forbid` overrides `permit`, but evaluation can skip policies with errors. The Port Daddy wrapper treats **any evaluation error as indeterminate/deny**, never as an acceptable allow.
7. Record diagnostics, policy/schema epoch, relevant entity versions, normalized context digest, and decision evidence.
8. Keep validator, symbolic analysis, and proof compilation offline.
9. Treat template-linked entities, partial evaluation/query-actions, batch APIs, and the local agent as experimental until their current Cedar release guarantees are reviewed.

## Cache only what is safe

First cache inputs, not decisions:

- parsed policy set and schema by policy epoch;
- entity slices by exact entity versions;
- lifecycle candidate edges;
- normalized immutable request fragments.

If decision caching is later justified, the key must include principal, action, resource, normalized context, policy/schema epoch, resource-state version, and every relevant entity version. Time-, budget-, lease-, revocation-, and freshness-sensitive requests should be noncacheable unless their moving values are explicit key material. TTL alone is not correctness.

## Permit binding

A permit candidate binds at least:

```text
intent digest
actor / AgentNode and Body
Harbor
typed action
exact resource and normalized parameters
policy and schema epoch
relevant entity snapshot/version digest
resource-state version
grant and budget reservation
issued-at / expiry
nonce and idempotency key
required postcondition observations
```

Conservative first proof: short-lived permits plus reauthorization on policy/entity epoch change. Delegation and full revocation remain open.

## The hard latency budget

Measure each component separately:

| Segment | Metric |
|---|---|
| Decode/normalize | p50/p95/p99 and allocation count |
| Lifecycle edge | lookup/guard latency |
| Entity hydration | cache hit/miss and slice size |
| Cedar evaluation | policies considered, diagnostics, p50/p99 |
| CAS transaction | contention/retry and fsync behavior |
| Actuator admission | permit verification |
| External effect | provider/network latency, separately |
| Observation/receipt | read-after-write latency and indeterminate rate |

Only the first five belong to an authorization-path claim. External effect and observation often dominate the user-perceived flow.

## Bottom line

State machines make legal-edge rejection, durable capture, and projection updates fast. Cedar is a credible candidate for microsecond-scale in-memory authorization evaluation. The product's more important speed affordance is **instant truthful progress through precisely named states**, while slow cognition and external reality continue asynchronously.

