# FIPA, A2A, MCP, and this trace contract

## Four different layers

| Layer | Direct source/access | What it does not establish |
| --- | --- | --- |
| FIPA interaction protocols | normative bodies unavailable in this drafting pass | a claim that this local trace is FIPA-conformant |
| A2A v1.0 | [specification](https://a2a-protocol.org/latest/specification/) and [pinned v1.0.0 protobuf](https://raw.githubusercontent.com/a2aproject/A2A/v1.0.0/specification/a2a.proto), accessed 2026-09-24 | identity, business-operation identity, or authority for any application action |
| MCP | [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), accessed 2026-09-24 | a durable conversation state or transport/effect proof |
| ConversationTraceV2 | local schema and offline validator | wire compatibility, remote delivery, payload digest recomputation, or runtime enforcement |

The A2A proto distinguishes Task id/context_id and Message message_id/task_id/context_id. These wire values are correlation fields in their protocol context; they do not authenticate their own business meaning.

## Adaptation method

Validate wire data against its pinned protocol rules. Then map admitted data into a new local envelope with protocol ID, conversation ID, epoch, sender principal reference, body generation, recipients, audience labels, scope, payload-digest string, and verification-reference string. Reject ambiguous mappings. Independently authorize any external action; local trace validation supplies no permit.

## Negative examples

- A successful A2A task status does not make a local COMPLETED trace unless the closed local predicate and fence acknowledgements are also present.
- A JSON-RPC response ID that matches a request ID does not prove payload freshness, principal continuity, or external completion.
- A local terminal CANCELLED records protocol cancellation only; it does not establish that a remote operation was halted.