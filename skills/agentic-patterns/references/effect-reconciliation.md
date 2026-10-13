# Reconciling uncertain external effects

For every consequential request, persist a stable intent and idempotency key
before dispatch. On timeout or host loss, query the external system by that key
or receipt before retrying. Classify the result as `committed`, `not_committed`,
or `unknown`; only the second state permits an ordinary retry. Preserve the
authorization and successor identity in the handoff record.

AWS documents that replay can execute a side effect again, that at-most-once is
per retry rather than a workflow-wide exactly-once guarantee, and that an
idempotency key must remain stable across retries:
[AWS Durable Execution idempotency guidance](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/).
AgentRewind likewise limits rollback to its controlled environment; network and
external-service effects remain outside that boundary:
[AgentRewind, 2026](https://arxiv.org/html/2608.14380v1).
