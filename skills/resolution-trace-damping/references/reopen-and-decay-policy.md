# Reopen and decay policy

A completion signal must bind to a task/node identity, source/work version, and completion evidence. Model states such as `UNRESOLVED`, `PARTIAL`, `RESOLVED`, `INVALIDATED`, and `REOPENED`; transition out of `RESOLVED` when new work, regression, or superseding input invalidates the evidence. An accumulated scalar with no decay or reset can suppress a reopened node indefinitely.

Separate immediate invalidation of stale completion evidence from signal aging. Signal expiry alone must not change the work ledger from completed to open. Before deployment, specify explicit policies that may combine: replace the signal on invalidation; decay it under a documented time/step rule; expire it after a TTL; or require an auditable reset. Define urgent-work precedence and ensure that bypass has independent authority. Do not equate deposit intensity with calibrated probability of completion unless measured.

For the stated candidate formula `effective = raw * max(0, 1 - d * res)`, test parameter bounds and edge cases (`raw=0`, `d=0`, `res=0`, `d*res=1`, `d*res>1`). This checks arithmetic semantics only. Pin the actual source revision and independently inspect whether `sense()` and `gradient()` use raw or effective pheromone.

Use a task set with solved, unresolved, falsely resolved, reopened, and urgent nodes. Measure repeated visits, missed reopened work, completion quality, and fairness across nodes. Keep `sense()` and `gradient()` tests separate. The inherited SOMA paths and benchmark claim have not been independently verified; no default parameter or expected coverage is established here.
