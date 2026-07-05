# Unit Economics And Guardrails

Use this when building the cost floor for a pricing plan and when designing the guardrails that keep usage-sensitive pricing from becoming a bill-shock incident.

## Building the cost floor

The cost floor is the fully-loaded $ cost to deliver one unit of the value metric, at the model and tool mix actually used in production — not the cheapest model you tested with.

| Component | What to include | Common mistake |
| --- | --- | --- |
| `modelTokenCost` | Blended input+output token cost across **every** model call in the task, including planning/verification/critic passes, not just the "main" generation call | Pricing off a single model's list price while the task fans out to 3-5 calls across cheaper and more expensive models |
| `toolCompute` | Sandboxes, browser automation minutes, container/VM time, any per-call tool or API fee (search, embeddings, vector DB reads) | Treating tool calls as "free" because they don't show up on the LLM provider invoice |
| `overhead` | Amortized support cost, payment-processor fee (~2.9% + $0.30 per charge is a reasonable placeholder), infra/observability, chargeback/dispute reserve | Ignoring overhead entirely because it's "small" — it is not small at high transaction volume with thin per-unit margins |

Recompute the floor whenever: a new model is added to the task's model mix, a model provider changes list price, task complexity grows (more tool calls, more retries), or usage patterns shift toward heavier personas. A cost floor computed once at launch and never revisited is a margin leak waiting to be discovered by finance, not by design.

**Target margin.** Dev-tools SaaS commonly targets 70-80% gross margin. Agent-labor products that carry real per-task inference and tool cost often run thinner — 40-60% is a realistic planning target, not a red flag by itself. What IS a red flag: a margin that goes negative on your heaviest, most-engaged personas, because those are typically the first and loudest adopters of an agentic feature.

## Guardrail design

Each guardrail below maps to a specific bill-shock failure mode observed in the market (see `references/pricing-model-decision-guide.md` for the Cursor/Copilot lessons).

### Spend cap

A hard, buyer-configurable ceiling that stops billing or execution once reached — not a soft warning email after the fact.

- Implementation options, cheapest to most robust: (1) a monthly $ limit enforced at the billing layer that blocks new runs once hit; (2) a per-task unit-count cap; (3) a real-time running-total check before each tool/model call inside the task loop (see the `cost-optimizer` skill for the runtime enforcement side of this).
- The cap must be visible and editable by the buyer in-product, not only settable by support.
- Decide and document the failure behavior when the cap is hit mid-task: hard stop with partial-result delivery, or graceful degrade to a cheaper model. Silent partial failure is worse than either.

### Budget preview

An estimated cost shown to the buyer **before** they commit to a run or a billing period — the single highest-leverage guardrail against bill shock, because it moves the trust moment before the spend instead of after.

- For a single task: estimate from historical average cost for similar tasks (by type/complexity), not a fixed per-task number that ignores task shape.
- For a billing period: project from the last N days of the buyer's own usage, not from a generic "average customer" number.
- Show a range, not false precision — "$2-6 estimated" is more honest and more trustworthy than a fake single-decimal number that is wrong half the time.

### Per-task estimate

A cost estimate attached to each individual task at submission time, distinct from the billing-period preview above. This is what lets a buyer decide "is this task worth running" one task at a time, which matters most for outcome-based and metered pricing where task cost varies widely.

### Transparent metering

A line-item receipt per task, available after the fact: which models were called, token counts, tool calls, and the resulting $ cost. This is the guardrail that turns a surprise invoice into an auditable one — even if the buyer never looks at it, its existence and discoverability is what prevents "I have no idea why this cost so much" from becoming a support escalation or a public trust incident.

- Store the line items durably (not just a rolled-up total) so a disputed charge can be walked back to specific task executions.
- Surface it in-product, not only in an exportable CSV nobody opens.

## Failure semantics: what "good" guardrail design actually blocks

| Guardrail present? | Usage-sensitive model, buyer hits an unexpectedly large task | Outcome |
| --- | --- | --- |
| None | Task runs to completion, bill arrives at month end | Bill shock, support ticket, possible churn/chargeback |
| Budget preview only | Buyer sees an estimate, can cancel before committing | Reduced surprise, but a buyer who proceeds anyway with no cap can still overspend past their intent |
| Spend cap only | Task halts once the cap is hit, no advance warning | No surprise overspend, but a buyer gets an unexplained mid-task stop with no context |
| Preview + cap + transparent metering | Buyer sees the estimate, can set/confirm a cap, and can audit the receipt after | This is the shippable combination — matches the Copilot "quota visible in-product" and OpenAI "spend limit in dashboard" reference patterns |
