# Unit Economics and Guardrails

## Cost-floor procedure

For one buyer-visible unit, record an auditable ledger:

1. Enumerate all model calls, including planning, verification, retries, and failure handling. For each, preserve input/output basis, rate-source date, and whether it is estimate or observation.
2. Add tools and compute that scale with the unit. A sandbox attempt, browser minute, or third-party call belongs here even when the model invoice does not show it.
3. Add allocated support, review, observability, payment, and dispute cost. Mark the allocation rule; an allocation is not a measured causal cost.
4. Sum only compatible periods and units. Separate a per-task model cost from a monthly processor fee rather than dividing without an allocation rule.
5. Calculate revenue, fully-loaded cost, contribution, and margin for each persona. Re-run when the model mix, retry rate, price, scope, or persona changes.

The checker's `unitCosts` field represents a deliberately simplified one-unit summary. The detailed ledger remains the source of its three numbers.

## Guardrail procedure

Usage-exposed models (metered, credits, hybrid, outcome) require every item below to pass this static review.

| Guardrail | Before commitment | Observable hand-check | Invalid/unknown case |
| --- | --- | --- | --- |
| Spend cap | buyer selects or confirms a limit | record configured limit and the path at limit | no limit or only an after-the-fact email is blocked |
| Budget preview | buyer sees a range before submitting | save a plan showing range, basis, and scope | absent or a post-run invoice is blocked |
| Per-task estimate | each submitted task gets an estimate | retain task id, estimate, and input assumptions | missing estimate is blocked even if a monthly forecast exists |
| Transparent metering | buyer can reconcile after a task | retain line-item receipt fields and correction path | aggregate-only total is blocked |

The checker verifies declared booleans. It cannot verify that a future system enforces them; that needs separate implementation evidence.

## Retry and unknown-outcome accounting

Treat retries as their own modeled scenario. If a retry is customer-billable, state the buyer notice and cap interaction. If not billable, include it in seller cost. For an outcome-priced unit, an unverified or conflicting result is not a completed outcome. Use the plan's policy such as `do-not-bill` or `hold-for-review`; do not infer success from a plausible artifact.

## Constructed accounting check

The `SKILL.md` example uses 20,000 fresh input + 1,000 output for a $0.00125 first call, then 3,000 fresh input + 1,000 output for a $0.00040 second call. The total is $0.00165. It also shows the assumed processor formula: $5.00 × 0.029 + $0.30 = $0.445. These are hypothetical rate inputs and simplified token accounting, not provider telemetry or a current quotation.
