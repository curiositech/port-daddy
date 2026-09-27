# Evaluation and cost method

## Build a representative and held-out test set

Start with a workload inventory. Label examples used to design prompts or fix code as development cases; reserve separate cases for evaluation and do not tune to their labels. After results influence a prompt or implementation, treat the exposed cases as development/regression material and use a fresh untouched holdout for the next promotion decision. Include normal work and the failures that matter: malformed inputs, permission denial, tool timeout, partial completion, restart, duplicate delivery, and missing evidence. Specify the rubric and who applies it before running candidates.

A small hand-checkable plan may include 12 constructed tasks: four read-only, four reversible writes, and four externally visible effects. Twelve is an example for showing denominators, not a sufficient sample-size rule. Adapt the set to the workload's risk and variation. Run the current process and each candidate on the same tasks, model/provider versions, tool scopes, data, prompts, deadlines, and retry policy unless one of those dimensions is the variable under test. Repeat tasks when stochastic variation is material; randomize run order where order or shared state may affect the comparison.

For each run, preserve task ID, candidate/version/configuration, rubric version, result, effect log, retry/timeout, latency, measured provider and infrastructure usage, human review time, interruption/recovery outcome, and test artifact. Report the task/run denominator and errors by task class. Provide per-task outcomes and uncertainty appropriate to the design; do not turn a small illustrative fixture into statistical proof. Keep evaluation outcomes separate from a proposed release threshold.

Minimum metric set for an agent infrastructure comparison:

- task success against the predeclared rubric;
- unauthorized and duplicate effects, including explicit zero counts;
- latency distribution and timeouts;
- model/provider and tool/runtime costs, including retries;
- human review and rework time;
- restart/recovery outcomes and whether effects repeat;
- maintenance and incident-response effort.

A plan states what will be measured. Only a run artifact supports an observed-result claim. A CLI declaration audit cannot verify that a production system actually emits these records.

## Cost and abort ledger

Before a run, define workload unit, currency, time window, data source for provider rates, per-task spend limit, aggregate budget/alert owner, and an abort action. Define retry count and deadline at the whole-task boundary; each retry is a new cost and must preserve idempotency for effects. Reconcile provider usage receipts against the task ledger. A cap declared in a plan is not provider-side enforcement until the deployed path is tested.

For a candidate, use a complete accounting identity such as:

`total attributable cost = provider + tools/runtime + storage/observability + human review/rework + integration/maintenance + training/operations`

`cost per accepted task = total attributable cost / number of tasks meeting the rubric without an unauthorized or duplicate effect`

State what is excluded. Do not hide failed tasks by counting only successful attempts. Preserve raw usage and failed attempts.

### Worked unit-cost arithmetic (constructed inputs)

The original example's figures are useful for teaching the arithmetic, but they are illustrative inputs rather than observed outcomes. Assume 200 reviews in one month, a baseline of 45 human minutes per review, a post-assistance review of 10 minutes, and a fully loaded review rate of $75/hour. Suppose each agent attempt costs $1.50, fixed platform/compute is $1,200/month, initial integration is 80 hours at $100/hour amortized over 12 months, monthly maintenance is 4 hours at $100/hour, and training/review calibration costs four hours at $75/hour. Assume for this worked calculation that 190 of 200 tasks meet the predeclared rubric without an unsafe or duplicate effect; this is a constructed assumption, not a finding.

- Baseline labor: `200 × 45/60 × $75 = $11,250`.
- Post-assistance reviewer labor: `200 × 10/60 × $75 = $2,500`.
- Provider usage: `200 × $1.50 = $300`.
- Amortized integration: `80 × $100 / 12 = $666.67` for the month.
- Maintenance: `4 × $100 = $400`; training: `4 × $75 = $300`.
- Add fixed infrastructure of `$1,200`; total constructed post cost is `$5,366.67`.
- Cost per accepted task is `$5,366.67 / 190 = $28.25` (rounded). Under these assumptions, the difference from the baseline is `$5,883.33` for that month, before any omitted costs or quality differences.

This calculation does not establish an ROI, productivity gain, or achieved savings. Change task volume, fully loaded labor, completion rate, integration amortization, rework, and maintenance based on evidence. Include the baseline and all costs in the comparison; if the two processes do not deliver comparable quality, the cost-per-accepted-task ratio alone is not a valid comparison.

## Retry example (constructed)

For a task with a $0.40 cap, an attempt times out after using $0.18 and has no confirmed effect. The ledger records that cost and marks the effect state unknown. A retry uses the same idempotency key, is admitted only if remaining budget permits, and costs $0.15; a read-back confirms one effect. Total recorded spend is $0.33, one successful task, two attempts. If effect state cannot be reconciled, stop and escalate rather than retrying a non-idempotent write. These numbers illustrate accounting only; set limits from actual risk and rate data.

## Migration comparison procedure

Do not infer that a framework migration improves reliability or determinism from feature descriptions. Freeze a representative task set, current implementation, model and policy; implement the smallest candidate needed to test the hypothesized gap; compare each against the baseline; inspect failures and costs; and retain, revise, or stop. If traffic is later shifted, do so under a separate rollout plan with a rollback owner. The exact diagram is [`../diagrams/migration-comparison.md`](../diagrams/migration-comparison.md).
