# Total-team budget, not a universal threshold

Budget the whole attempt tree: `total = planning + worker attempts + retries + review + reconciliation + operator interruption`. Reserve the worst permitted retry/review path before dispatch; release only after independently witnessed settlement. Choose a budget by the decision’s downside, evidence gap, and marginal expected quality improvement, not a universal token, dollar, or time threshold.

Worked choice: a $40 cap may reserve $8 planning, two $10 workers, one $8 review, and $4 reconciliation. If one worker needs a retry, it must consume an explicit reserve or halt; it cannot silently borrow review money. Report quality, harmful effects, unresolved effects, cost, and elapsed time together.

Hypothesis: an extra review is justified only when its estimated reduction in costly false acceptance exceeds its full cost plus the delay/risk it creates. Measure that locally by task class; do not publish an assumed crossover.