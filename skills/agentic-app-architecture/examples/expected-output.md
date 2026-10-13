# Example: external-post declaration and inert effect fixture

A release-summary service stages a report locally and may post an approved link externally. It declares detailed action/evidence/uncertainty summaries, `privateReasoningPolicy: not-requested`, durable task state/provenance, and `effectClass: external-or-irreversible`. Its control is human approval scoped to the named channel; its receipt records request ID, response, observed state if available, and compensation status.

A proposed inert fixture supplies a mock transport with unapproved, stale-approval, duplicate-key and receipt-failure cases. Reject the first two before dispatch. For a duplicate, return the prior result or unresolved state without a new dispatch. Distinguish a pre-dispatch receipt-storage failure (hold dispatch) from a receipt lost after transport acceptance (effect may have happened; record unknown, reconcile by request ID and do not blindly retry). No live message is sent by a mock. These are an implementation test plan, not tests performed by the bundled declaration auditor.

The companion [sample input](sample-input.json) shows the contrasting low-risk read-only case. Both are static declarations, not runtime evidence.
