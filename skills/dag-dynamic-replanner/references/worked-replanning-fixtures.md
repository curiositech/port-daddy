# Worked replanning fixtures

These are constructed offline fixtures. They specify planning evidence and rejection branches; none claims to run a provider or compensate an external effect.

## Security scan: V1 to V2

| Version/node | Inputs and state | Output/decision | Hand check |
| --- | --- | --- | --- |
| V1 `build` | source tree; complete | `build@b1` | Its digest is part of `test@t1` provenance. |
| V1 `test` | `build@b1`; complete | `test@t1` | The test artifact is eligible for V2 reuse only if its digest and scope match. |
| V1 `deploy` | `test@t1`; pending | `deploy@d1` | It never starts, so V2 marks this planned consumer stale rather than mutating it. |
| V2 `security-scan` | `test@t1`, candidate deployment digest | `scan@scan1` | A missing gate definition or a falsely claimed digest-matched receipt rejects the plan. A pending scan can be planned, but its consumer cannot start without the valid receipt. |
| V2 `deploy` | `scan@scan1`, approval evidence, action authority | `deploy@d2` | Absent artifact-bound approval or current action authority, do not start the deploy effect. |

The proposal carries expected head `V1`. If the actual head is V3 at compare-and-swap time, V2 is rejected and rebuilt from V3; `test@t1` is not silently reused until V3’s contract is checked.

## Connector fallback: acceptance versus rejection

| Consumer requirement | Candidate `file-reader@fr1` evidence | Result |
| --- | --- | --- |
| `analyse-users` needs customer records for reporting period P, with source identifier and field semantics. | P, source identifier, required fields, and meaning all match. | Candidate is admissible for this consumer. |
| `analyse-products` needs catalogue snapshot P with the same product taxonomy. | Snapshot and taxonomy match. | Candidate is admissible for this consumer. |
| `analyse-orders` needs transaction-time ordering and full payment-state history. | File contains rows with equal field names but only daily aggregates. | Candidate is rejected for this consumer; V2 cannot replace `db-connect` for the fan-out. |

The hand check rejects V2 as a whole because `report` requires all three analyses. It avoids the false repair “the graph is connected, therefore the fallback is valid.”

## Capacity change: consistent arithmetic

The memory capacity is 8 GiB. V1 leaves `data-prep@p1` mounted at 4 GiB; `model-training@mt1` requires 6 GiB. Requested peak is `4 + 6 = 10 GiB`, exceeding capacity by 2 GiB.

| V2 node | Inputs | Reservation | Output/branch |
| --- | --- | ---: | --- |
| `stage-prep@sp1` | `p1` | 1 GiB | While holding p1, uses 4 + 1 = 5 GiB; writes a digest-bound read-only artifact then releases the 4 GiB in-memory reservation. If it cannot prove equivalent training input, reject V2. |
| `model-training@mt2` | `sp1` | 6 GiB | `1 + 6 = 7 GiB` with the 1 GiB staging/read buffer retained during training, within 8 GiB. It remains blocked if the reservation is unavailable. |
| `evaluation@e2` | `mt2` | 2 GiB | Rewired only after `mt2` contract validates; starts after training releases its 6 GiB reservation, retaining at most the 1 GiB buffer (3 GiB total). |

This fixture proves neither model accuracy nor an arbitrary shard/merge design. It only proves the stated reservation arithmetic and conditional plan admission.

## Unknown prior external effect

`publish@op-42` sent request digest `req-9` and then timed out after possible transmission. Record `op-42`, `req-9`, last response, and outcome `unknown`. Provider/readback success produces a receipt and forbids another publish attempt. A documented definite-absence response plus an idempotency/retry contract permits retry using `op-42`; any ambiguous response remains on authorized-resolution hold. Reverting V2 does not undo a provider effect.
