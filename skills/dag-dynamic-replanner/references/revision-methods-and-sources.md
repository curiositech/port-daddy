# Revision methods and source scope

## Read sources

- Python 3.14 [`graphlib`](https://docs.python.org/3/library/graphlib.html), relevant `TopologicalSorter`, `prepare`, `get_ready`, `done`, and `CycleError` API sections read on 2026-09-24. It supports predecessor readiness and exposes a cycle witness; it does not define artifact provenance, authority, resource admission, or retry safety.
- AWS Step Functions [state-machine versions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-state-machine-version.html) and [`StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html) sections read on 2026-09-24. AWS versions are product-specific immutable snapshots. Its documented same-name/input Standard-execution behavior is not a universal idempotency guarantee; Express execution differs.
- Temporal’s official [Workflow Definition](https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-definition.mdx) and [TypeScript versioning](https://github.com/temporalio/documentation/blob/main/docs/develop/typescript/workflows/versioning.mdx) pages were read on 2026-09-24. They describe Temporal-specific deterministic replay and compatibility for in-flight histories, not generic DAG mutation semantics.

## Local proposal boundary

This skill proposes immutable plan snapshots, expected-head compare-and-swap admission, typed artifact evidence, descendant invalidation, approval/action-authority gates, and unknown-effect reconciliation. Those are local engineering policy inspired by the sources above; they are not guarantees supplied by Python, AWS, or Temporal.

For each proposal record the expected Vn head; changed producer outputs and consumer contracts; producer digest and source/provenance/freshness/scope/meaning constraints; running-node revision/input identity; capacity and reservations; and retry or reconciliation contract. Reject before CAS on invalid contracts, cycles, missing gate definitions, invalid claimed-existing evidence, or infeasible resource requirements. A plan can include a pending producer or approval step; execution stays blocked until that step produces valid evidence and the effect has current authority and resource admission. A CAS mismatch means the proposal is stale, not admitted.
