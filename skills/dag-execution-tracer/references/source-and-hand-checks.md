# Trace design: run identity, lifecycle, coverage, and recovery

Use a trace to make observations queryable. A trace is not an execution receipt,
and it does not establish that every node ran or that an external effect
occurred. Keep an append-oriented record per attempt; never overwrite a failed
attempt with a later retry.

## 1. Identity and event model

Bind every observation to the immutable execution identity visible to the
investigation:

| Identity / field | Purpose |
|---|---|
| run ID + graph revision | Names the execution and the exact declared graph |
| node ID + attempt ID | Separates node work from retries and speculative attempts |
| trace/span context | Represents nested work and trace joins |
| event ID + source + sequence | Deduplicates/reorders exported event records within its declared scope |
| input/output artifact ID, digest, schema | Links consumed/produced values without storing sensitive payloads by default |
| actor/tool/model/config revision | Makes execution conditions queryable |
| clock source and uncertainty | Constrains temporal interpretation |
| sampling/drop/export counters | Makes missing coverage visible |

A node can have multiple attempts. Keep immutable attempt start, retry reason,
terminal observation, and any receipt reference separately. Define lifecycle
states explicitly, for example `scheduled`, `started`, `yielded`, `retry`,
`success`, `failed`, `cancel-requested`, `cancellation-confirmed`, and
`unknown`. “No terminal event observed” is not a terminal state.

Use parent context for a nested child operation in the same trace tree. Use
links to relate fan-in inputs, scatter/gather work, or a cross-trace causal
relationship that is not accurately represented as a parent. A link is
explicit provenance, not proof that the linked event caused the current event.

## 2. Instrumentation boundaries and partial traces

At node entry, create an attempt ID and record the graph/run/node identity,
start event, and allowed input digests. At node exit, record the outcome, output
identities, and terminal event. A `finally` block is useful best-effort cleanup
for exceptions handled by that process; it cannot emit an end event after a
process crash, machine loss, or forced termination. Use an independently
observable durable event/receipt path if crash-survival is required, and still
report gaps when that path cannot confirm state.

For cancellation, record `cancel-requested` at the requester, then separately
record an acknowledgement/terminal receipt if received from the worker. Without
that acknowledgement, state is `unknown`; do not mark the work cancelled merely
because the request was sent. On restart, query the worker/target receipt before
repeating a possibly effectful attempt.

Sampling and exporter failure require explicit coverage metadata: sampled
policy/config version, sampling decision for the run/node/attempt if available,
export queue loss, dropped-event count, query window, and expected-node set for
the selected graph revision. An absent span can mean unsampled, not exported,
query mismatch, instrumented-path gap, or never started. It is not evidence of
success, skip, or non-execution without another source.

## 3. Time and causality queries

Use a monotonic clock for elapsed duration within one process where available;
record wall clock separately for display and cross-system correlation. Record
clock source and known uncertainty/skew. Cross-machine timestamp order alone
does not prove happens-before: events can be concurrent or clock-shifted. Use
explicit parent/causal links, event sequence scoped to its producer, and the
DAG revision's declared prerequisite relation to explain possible order. Do not
infer causality from adjacency in a sorted timeline.

For a trace query, state the expected run/revision/node/attempt set, time range,
filters, and coverage status. Return `complete-for-query`, `partial`,
`sampled`, `dropped`, or `unknown` with the query assumptions; “complete” is
only relative to the instrumented/exported source and query scope. If an
expected node has no span, look up its attempt/receipt by stable ID and report
what that source says. Never make the trace system invent a terminal status.

## 4. Bounded capture and overhead evaluation

Choose granularity from a concrete question: run/node/attempt lifecycle for
basic diagnosis; selected tool calls and redacted artifact digests for data-flow
questions; richer payload capture only with a data-class and retention basis.
Measure added CPU, wall time, bytes, exporter queue pressure, and query utility
on representative normal, fan-in, retry, cancellation, and failure paths. Compare
matched tracing-on/off runs if the workload allows; record variance and config
rather than relying on a universal “safe overhead” percentage. Use an explicit
sampling/retention budget, sample policy, access restrictions, and deletion
behavior. A digest is not anonymization and does not replace a data-retention
policy.

If overhead is high, first identify the expensive operation (serialization,
large attributes, network export, indexing) and reduce or redact the relevant
field. If lowering sampling reduces the chance of observing rare failures,
record that tradeoff and use targeted capture only when authorized. Never silently
remove error, cancellation, or unknown-effect events while retaining a label
that implies complete coverage.

## 4a. Payload serialization and capture-cost diagnosis

Keep attributes small, typed, and redacted. Store a digest plus a provenance
pointer when that is sufficient; a digest alone does not establish content
truth or permit recovery of an omitted artifact. Serialize through a defined
schema. Reject or safely represent cyclic/non-JSON values rather than making a
raw output's `toJSON` behavior part of the trace contract. Bound capture size,
attribute count, retention, and access by local data policy; do not copy full
prompts, credentials, or sensitive outputs into a span by default.

**Constructed measurement case.** A 50-node analysis run takes 30 seconds with
capture disabled and 45 seconds under a diagnostic configuration. Those values
are an illustration, not a general overhead threshold. First separate time
spent producing attributes, redacting/serializing, queueing, exporting, and
indexing. Suppose the profiler attributes most added time to serializing large
node outputs. Repeat a matched workload with payload capture disabled but
redacted artifact digests and attempt/event metadata retained. Compare runtime,
bytes, dropped events, query usefulness, and failure-path coverage. If the
lighter mode loses the evidence needed to diagnose a rare path, state that gap
and use a specifically scoped, authorized diagnostic capture rather than
calling the sampled trace complete.

## 5. Worked parallel-fan-in investigation

Constructed run `r7`, graph revision `g12`: `A -> {B,C} -> D`. The query expects
attempts `A/1`, `B/1`, `C/1`, and `D/1`.

| Record | Observation | Safe conclusion |
|---|---|---|
| A/1 | success, output digest `a7` | A reported success in this instrumented source |
| B/1 | success, output digest `b4` | B reported an output |
| C/1 | timeout event, external target status unknown | C may or may not have caused an effect |
| D/1 | input map names `B=b4`, `C=null` | D consumed the recorded null value; this does not explain why it was supplied |
| trace query | C tool child absent; sampling/export status says partial | Child absence is a coverage gap, not proof the child did not run |

Next query C's attempt/target receipt by the stable attempt key. If target state
confirms the effect, preserve that receipt and do not repeat the same effect. A
retry after absence requires a current authoritative terminal-absence receipt
bound to the exact operation plus a fence/epoch that excludes a late first
commit, current retry authority, and budget. A separate validated
idempotency/deduplication key may permit retry only for the same operation and
context, under current retry authority and budget. If
unknown, keep it held. If a compensating action is considered, first confirm its
own scope/authority, applicability to the exact observed effect, and postcondition;
then fence the old operation or use a validated same-operation deduplication
rule before separately authorizing any retry. “Compensation is authorized” alone
is not enough to repeat an unknown non-idempotent request.

## 6. Worked cancellation and retry record

Attempt `C/2` receives a cancellation request during a tool call. The caller
records the request ID and time. No worker acknowledgement arrives before the
caller exits. The trace terminal is therefore `unknown`, not `cancelled`. Keep
attempt 2 in history and query the worker/target by operation identity. If a
separate authoritative receipt confirms cancellation completed before any effect
and the target fence excludes a late first commit, record the receipt and
evaluate a newly authorized attempt. If the effect committed, preserve its
result and avoid a duplicate. If status remains unknown and there is no proven
same-operation idempotency/deduplication contract, hold and escalate. Do not
interpret a later wall-clock event alone as the missing acknowledgement.

## Representation sources and limits

The [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/)
describes span context, parentage, links, and span lifecycle fields; its
[overview](https://opentelemetry.io/docs/specs/otel/overview/) discusses links
for relationships such as scatter/gather. [CloudEvents v1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)
requires event identity attributes including `source` and `id`. These are
representation/interoperability conventions. They do not certify completeness,
causality, durable delivery, successful execution, or target effects.


## Constructed event record

This local JSON example is a representation worksheet, not an OpenTelemetry
wire-format schema or proof of a target effect. Abbreviated digests must become
exact artifact digests in a real record.

```json
{
  "source": "review-worker-2",
  "eventId": "event-17",
  "sequence": 17,
  "runId": "r7",
  "graphRevision": "g12",
  "nodeId": "C",
  "attemptId": "C/1",
  "operationKey": "review-request-93",
  "traceId": "trace-r7",
  "spanId": "span-C-1",
  "parentSpanId": "span-run-r7",
  "lifecycle": "unknown",
  "observedEvent": "timeout",
  "clock": {"kind": "process-monotonic", "elapsedMs": 30000},
  "input": {"artifactId": "A-result", "digest": "sha256:abbreviated", "schema": "review-input-v2"},
  "coverage": {"kind": "partial", "droppedEvents": 1},
  "receiptRef": null,
  "effectState": "unknown"
}
```

Here `source + eventId` identifies the emitted observation. `operationKey`
identifies the intended operation, while `attemptId` identifies this attempt.
A re-export may repeat the same event identity; a retry must not pretend to be
the same attempt. A reused operation key prevents duplicate effects only when
the target's validated deduplication contract actually covers it. The null
receipt and missing child event keep the result unresolved.
