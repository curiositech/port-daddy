# Example Output

## Surface Matrix

| Workflow | Actor | Primary Surface | Secondary Surface | Rationale |
| --- | --- | --- | --- | --- |
| Configure provider tokens | Human operator | GUI | CLI | Routine setup must be discoverable; CLI remains useful for agents and CI. |
| Trigger review agent from app | Application code | SDK | API | The app needs typed calls, retries, and receipts. |
| Let a model inspect fleet status | Model client | MCP | API | Model needs schema-governed tool access. |
| Send tube event to worker | Service or script | SDK | CLI | Listener/sender helpers prevent every language from reimplementing envelope rules. |

## Tube Workflow Codegen Brief

- Channel: `project.review.request`
- Message schema: `tube-message.v1`
- Target languages: TypeScript, Python
- Sender: `sendReviewRequest({ repo, diffRef, requester })`
- Listener: `onReviewRequest(async (message) => { ... })`
- Receipt: append `review.receipt.v1` with status, artifact URLs, and error envelope.
