# Effect-boundary contract

For every external write, declare the operation, resource, authorization,
idempotency identity, expected receipt, authoritative reconciliation query, and
successor rule. Test pre-dispatch failure, post-dispatch timeout, duplicate
successor, duplicate receipt, and revoked authorization. Treat `unknown` as a
terminal handoff state until the authoritative system resolves it.

AWS documents that retry semantics alone do not provide workflow-wide exactly
once behavior and recommends stable idempotency tokens for compatible external
services: [AWS idempotency and retries](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/).
