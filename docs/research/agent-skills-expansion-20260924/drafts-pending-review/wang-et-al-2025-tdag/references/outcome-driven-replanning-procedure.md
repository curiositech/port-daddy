# Outcome-driven replanning procedure

This procedure converts the dynamic-update idea into a reviewable local design. It is a proposed implementation recipe, not a claim that TDAG supplies a production transaction protocol.

## Task record before execution

Represent each work item with stable ID; goal clause; output schema; preconditions; evidence required; dependencies; authorized read/write/effect scope; status; attempt history; and result provenance. Distinguish a dependency on a fact from a dependency on an action having completed. Record source revision and validity interval for mutable facts.

A result can be `SATISFIED`, `FAILED_NO_EFFECT`, `EFFECT_UNKNOWN`, `PARTIAL`, or `BLOCKED`, with observed state, evidence, unmet conditions, and cost. A timeout is not `FAILED_NO_EFFECT`; a remote operation might have committed despite a lost response.

## Replanning steps

1. **Validate the result.** Check output schema, evidence provenance, task scope, and external-effect receipt. Separate observed facts from the worker’s interpretation.
2. **Re-evaluate preconditions.** For every unfinished task, test declared preconditions against current evidence. Never assume the intended prior state was reached.
3. **Compute the affected slice.** Mark descendants stale only where declared premise depends on changed or unknown fact/effect. Keep independent work and still-valid evidence.
4. **Rebuild that slice.** Preserve goal clauses and hard constraints. Replace invalid subgoals only where an equivalent permitted path exists. Record added, removed, and changed nodes with reasons.
5. **Review authority and cost.** Planning cannot grant tools or effect authority. A new payment, booking, write, or publication still needs separate admission and idempotency/reconciliation rules.
6. **Check termination.** Set a task-specific retry or cost budget before execution. Exhaustion yields `BLOCKED` with options, not fabricated completion.

## Worked case: flight change invalidates a hotel transfer

Constructed scenario: an itinerary assumes arrival at 15:00 and a shuttle pickup. The carrier reports a cancellation and offers 19:30 arrival. The coordinator marks the pickup and first evening meal stale because they depend on arrival time. A museum ticket for the following afternoon has an independent booking and remains valid. It verifies whether the replacement flight was actually booked before regenerating transfer work. If booking status is unknown, it holds the branch and does not submit a duplicate booking.

The revised graph supersedes the old arrival premise, preserves the verified museum ticket, and links transfer choices to the replacement-flight receipt. This illustrates dependency management, not a TDAG benchmark result.

## Evaluation protocol

Compare static and dynamic policies on the same tasks, tools, models, budgets, and adjudication rules. Tune on training tasks and use held-out tasks for evaluation. Report end-to-end success and partial constraints separately, plus planning tokens, latency, retries, effect reconciliation, and human interventions. Include an equal-budget single-agent baseline. Publish benchmark version, sample count, construction, scoring rules, and uncertainty; avoid causal claims from averages without an appropriate design.

## Source scope

Wang et al., “TDAG: A Multi-Agent Framework based on Dynamic Task Decomposition and Agent Generation,” arXiv:2402.10178. The paper describes the framework and benchmark experiments. Metrics belong to its travel-planning setup and named generalization environments, not a universal reliability estimate. It does not establish this reference’s effect-unknown, transaction, or admission contract; these safeguards are additions.
