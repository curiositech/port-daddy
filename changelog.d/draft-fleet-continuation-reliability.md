type: fixed

- **Fleet checkpoint continuations no longer wait behind unrelated reviews or masquerade as hundreds of retries.** `FLEET_CONTINUATIONS` now targets an isolated `fleet-continuations` consumer with one-message batches, concurrency one, three bounded retries, durable duplicate/replay recovery, and the existing fail-closed DLQ; receipts and operator APIs retain the monotonic cursor as compatibility evidence while rendering continuation sequence and per-message platform attempt separately.
