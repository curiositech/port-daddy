# Negative feedback and resolution-signal evaluation

[Robinson, Jackson, Holcombe and Ratnieks, “No entry” signal in ant foraging (2005), DOI 10.1038/438442a](https://www.nature.com/articles/438442a) was accessed on 2026-09-24 at publisher-abstract depth. It reports a repellent signal marking unrewarding paths in Pharaoh's ants. This supports a narrow biological analogy for local negative feedback. It does not establish software completion semantics, transferable parameter values, or improved agent coordination. Full methods and quantitative results were not accessible and are not used here.

## Constructed comparison

Use the same task graph, availability sequence, task versions, completion oracle, agent policy and randomness across three arms: no resolution score; score aging alone; and version-bound completion plus immediate invalidation and aging. Include zero productive work, partial completion, false completion, a reopened task at the same file path, new urgent work, and a lost invalidation event. Keep completed tasks excluded by the same eligibility ledger in every arm; otherwise the experiment confounds task-state knowledge with score attenuation.

Report useful accepted work, repeated attempts, latency to rediscover reopened work, missed eligible tasks, per-task waiting time and overhead. Count shared prerequisites separately from duplicate deliverables. Include timeouts and unknown outcomes in denominators. Tune on development workloads and reserve different task graphs or later periods for evaluation; a favorable arithmetic example is not a workload result.

## Failure localization

Trace the current work version through completion evidence, signal write/replacement, aging/invalidation, read helper, candidate ranking, actual selection and accepted output. A changed read value with unchanged selections is an instrumentation result, not evidence that damping reduces duplicate work. A reduced revisit count with more missed reopened work is a tradeoff to report, not success by itself.

Book candidate: one worked trace contrasting signal expiry with work reopening would clarify the existing state/evidence distinction. Its novelty and placement require manuscript review; no new result is claimed.
