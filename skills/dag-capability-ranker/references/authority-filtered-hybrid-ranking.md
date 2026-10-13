# Authority-filtered hybrid ranking procedure

1. Freeze a candidate catalog snapshot and task contract: required capabilities,
forbidden effects, data class, tool availability, and acceptance evidence.
2. Apply authority/disclosure/effect filters before retrieval. A capability found
later that violates a hard constraint invalidates the provisional rank and starts
a new eligible set.
3. If hybrid retrieval is required, retain lexical ranks and compare dense ranks
only for identical immutable `spaceId`. A policy-permitted lexical-only fallback
must be labeled degraded; it cannot silently satisfy a requested hybrid contract.
4. With local constant `k=60`, example ranks are X `(lex=1,dense=6)` and Y
`(lex=4,dense=1)`: `RRF(X)=1/61+1/66≈.0315`,
`RRF(Y)=1/64+1/61≈.0320`. This orders retrieval evidence only. If Y's contract
allows a forbidden live probe, it is excluded before recommendation; X can win
among feasible candidates. Record units/cohort/uncertainty for reliability,
cost, and latency preference evidence separately from IR ranks.
5. If remaining preference evidence is missing or tied, return an ordered tie or
abstention rather than fabricate a margin.

[Cormack et al. (2009)](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)
introduce RRF and report IR experiments. [Bruch et al. (2022)](https://arxiv.org/abs/2210.11934)
show fusion choice/parameters vary by tested benchmark. Neither establishes
agent competence or authorization.

## Operational preference worksheet

After hard feasibility and retrieval review, select against the user's declared
objective. For example: “Among eligible offline reviewers with observed task
acceptance at least 0.85 on the named cohort, prefer lower p95 latency; report
uncertainty before recommending.” The 0.85 target is a **constructed local
policy**, not a literature threshold. If it is a guarantee requirement,
observed proportions alone cannot satisfy it.

| Candidate | Accepted / attempted | p95 seconds | Mean total cost / attempt | Eligibility |
| --- | ---: | ---: | ---: | --- |
| Fast | 82 / 100 | 30 | 0.04 units | passes static scope |
| Thorough | 91 / 100 | 80 | 0.09 units | passes static scope |
| Live probe | 96 / 100 | 45 | 0.07 units | forbidden network effect |

These are teaching observations on the same hypothetical task set, evaluator,
versions and measurement period. Include failures and timeouts in denominators
and record their latency/cost accounting. The preference selects Thorough under
the observed-rate rule; Fast does not meet it and Live probe is ineligible.
Under an alternative 40-second p95 requirement, neither eligible candidate
meets both constraints. Return that infeasibility instead of concealing it in
a weighted average. Sample uncertainty may make a deployment recommendation
inconclusive even when this descriptive comparison is clear.

If the user actually wants a weighted utility, declare units, normalization,
weights and whether each criterion is a hard constraint or a preference before
looking at winners. Show per-factor contributions and sensitivity to plausible
weights. Retrieval scores, cost, success proportions and latency are not
naturally commensurate. Do not invent a 0-to-1 success probability by adding
them. A Pareto tie can be the honest answer.

## Failure diagnosis and repair

| Observation | Check | Repair and limit |
| --- | --- | --- |
| Historical winner now fails | Cohort, version, time window, denominator and recent failure causes | Segment old/new observations and rerun matched tasks; do not multiply success by an arbitrary recency ratio. |
| One factor controls every rank | Units, normalization and contribution sensitivity | Correct scale errors or confirm the intended priority; dominance is not automatically a defect. |
| Best rank cannot run in scope | Tools, data disclosure, effect and resource prerequisites | Invalidate provisional recommendation and recompute the eligible set. |
| New candidate has no history | Distinguish missing evidence from observed failure | Mark unknown; request a bounded evaluation if warranted. Do not invent a cold-start penalty. |
| Paired labels inflate a score | Whether each bonus reuses the same evidence | Count each evidence item once; evaluate the actual composition if synergy matters. |
| Only one candidate remains | The same feasibility and evidence checks | A singleton has rank 1, not 100% confidence. |
| Scores are tied or unstable | Parameter sensitivity and evidence uncertainty | Preserve a tie or abstention; an arbitrary lexical order is only a display convention. |

The output packet records objective, feasible set, rejections, source snapshots,
RRF lists and `k`, operational measurements and units, uncertainty, missing
cases, preference rule, final recommendation and what evidence could reverse
it. RRF is prior art for rank fusion; this worksheet is a local application to
skill selection, not a claim that the cited IR studies validate this policy.
