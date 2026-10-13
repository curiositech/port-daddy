# Versioned interchange boundary

## Sources and access

Read 2026-09-24: [A2A v1.0.0 specification](https://a2a-protocol.org/v1.0.0/specification/), [pinned A2A proto](https://github.com/a2aproject/A2A/blob/v1.0.0/specification/a2a.proto), [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), and [JSON-RPC 2.0](https://www.jsonrpc.org/specification). Version-specific behavior is not inferred from a protocol name.

## Role boundary

MCP describes host/client/server interaction for tools and context. A2A describes remote agent messages and tasks. JSON-RPC supplies request/response/error envelope semantics. A selected protocol can define security or authorization mechanisms, but the application still has to bind its trust decision, stable business-operation key, and independently verified external-completion evidence to the concrete deployment.

## Bridge worksheet

For an MCP tool delegating to A2A, record: caller principal and permitted tool; A2A target/card/version; task request; stable application operation key; transport request ID; returned task state; local artifact verification. Keep these identifiers distinct. The A2A source states that task IDs are server-generated and context IDs can be client-provided. A changed transport request ID on retry is not proof that an external effect is new or absent. A stable application key is only useful when the receiving system has an explicit idempotency/reconciliation contract for that key.

## Validation provenance

Schema/proto -> generated binding -> runtime parser -> application authorization -> task/effect receipt are separate steps. A generated type only establishes a local code artifact; run the parser and retain version/result before treating input as valid. Unknown-field behavior must follow the selected version's documented compatibility rule.

## Local planning helpers

`../scripts/context-budget.mjs` accepts only safe nonnegative local integers, measures
source-ordered full envelopes after every candidate removal, and never removes a
required part. `../scripts/retry-policy.mjs` accepts only a validated local policy; it
treats a trusted Retry-After as a minimum, returns unresolved if that minimum conflicts
with a local cap/deadline, and plans a next start only. A confirmed known rejection
requires a trusted absence/reconciliation contract supplied by the caller.

## Limits

No generated SDK, MCP server, A2A service, transport, retry request, remote
reconciliation, or external receipt was executed in this drafting pass. The pure local
helpers do not authenticate an error classification or bound request execution.