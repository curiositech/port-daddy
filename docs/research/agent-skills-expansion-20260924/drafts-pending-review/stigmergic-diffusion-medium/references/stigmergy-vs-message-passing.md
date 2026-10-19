# Field sensing and message protocols

A scalar graph field can make nodes salient without addressing a recipient. A message
protocol can identify a recipient, retain a payload, acknowledge receipt, and reconcile
retries. Costs depend on graph representation, reader count, cadence, and storage; do
not infer `O(1)` field coordination or `O(N^2)` messaging in general.

Additive deposits can duplicate a signal unless an external idempotency rule detects
them. Decay fades a value but cannot detect dead workers, recover abandoned work, or
prove coverage. The field supplies no assignment, delivery, or completion guarantee.
