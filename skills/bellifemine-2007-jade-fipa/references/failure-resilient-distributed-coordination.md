# Failure-aware conversation handling

## Separate observations from causes

Record `REFUSE`, `FAILURE`, missing reply, invalid content, invalid output, and late report as distinct local observations. In the Contract Net exchange discussed here, REFUSE declines the CFP instead of proposing; FAILURE after acceptance reports inability to fulfill the accepted work, including an unsuccessful attempt. An absent reply proves only that the local window closed, not a crash, message loss, cancellation, or external-effect state.

## State and recovery procedure

Keep immutable request digest, participants, correlation tokens, reply-by interpretation, accepted proposal, received headers/content bytes, policy version, and disposition per conversation. An FSM moves `collect` to `no-selection`, `await-report`, `reported-failure`, `missing-report`, or `verify`; `INFORM` is not verified completion. An authorized retry creates a new attempt or explicit continuation and preserves the old one. A collector calls `block()` after a queue check; never spin-wait.

Before accepting content, check correlation and declared language/ontology, then extract it. `CodecException` and `OntologyException` are invalid-content dispositions, not permission to fabricate a belief. A successful decode still proves neither truth nor authority. Validate any output reference independently and authorize remediation separately.

## Local timeout template

State the clock source, starting state, late-message disposition, retry authority, and compensating-effect authority. This bundle specifies no universal duration/retry count and verifies no durable queue, replay protection, cancellation acknowledgement or replica failover. Establish those properties from the selected implementation and application tests before depending on them.

Official JADE Programmer’s Guide “Agent Tasks: Behaviours” and [ContentManager API v4.6.0](https://jade.tilab.com/doc/api/jade/content/ContentManager.html), accessed 2026-09-24, support these mechanics.
