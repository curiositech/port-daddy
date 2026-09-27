# Claim-specific monitoring procedure

For numeric iteration, record function, state, residual/objective, evaluator,
revision, budget and stop predicate. Example `x[n+1]=(x[n]+2)/2` from `x0=0`
gives `1,1.5,1.75`; it approaches 2, while a tolerance and finite stopping rule
remain local policy. Track improvement, plateau, regression, oscillation and
measurement noise separately.

For repeated editorial/agent judgments, preserve artifacts and evaluator
versions. A fixed evaluator repeatedly used to tune a draft is development
material; use a fresh held-out evaluator/artifact set for final evidence. Stable
scores do not make a claim true. For DAG completion, use run/node/output
revision and receipts: `r7/n3/output-v2` may succeed without making original
`r7/output-v1` successful. For replicas, same update set plus defined merge and
equivalent state supports convergence only; it says nothing about quality.

Hard budget, authority, missing receipt, conflict, or unknown effect yields
hold/escalate, not a universal window/slope rule. [Jagadeesan & Riely
(2018)](https://link.springer.com/chapter/10.1007/978-3-319-89884-1_34) is CRDT
scope; [Hellerstein & Alvaro (2020)](https://doi.org/10.1145/3369736) is
coordination context, not agent quality proof.


## Worked stopping trace

Consider the constructed deterministic iteration `x[n+1]=(x[n]+2)/2`,
`x0=0`. Here the known fixed point is 2, so define residual `r[n]=|2-x[n]|`.
Choose the **local illustrative** stopping rule `r[n] <= 0.125`, no violated
invariants, and at most four updates. This rule is not a universal agent metric.

| Updates n | x[n] | Residual | Recommendation |
| ---: | ---: | ---: | --- |
| 0 | 0 | 2 | continue if authorized |
| 1 | 1 | 1 | continue |
| 2 | 1.5 | 0.5 | continue |
| 3 | 1.75 | 0.25 | continue within remaining update |
| 4 | 1.875 | 0.125 | criterion met; owner may close |

For this specific recurrence the residual halves each update; that algebra
justifies the trace. With only three updates authorized, stop at residual
0.25 and report the unmet criterion. Budget exhaustion is not acceptance.
Likewise, requiring residual below 0.01 with a four-update cap is infeasible
for this recurrence; report the conflict without changing the target.

## Diagnose a trend without pretending it predicts success

| Constructed observations of a lower-is-better residual | Interpretation and next check |
| --- | --- |
| 0.30, 0.30, 0.30 | possible plateau; inspect measurement resolution and whether attempted changes should affect this residual |
| 0.30, 0.35, 0.40 | observed regression; inspect changed artifacts and verifier inputs before another experiment |
| 0.20, 0.40, 0.20, 0.40 | oscillation; record the alternating strategies or states, not merely their average 0.30 |
| 0.30, 0.29, 0.31 with stated measurement uncertainty 0.03 | insufficient evidence of improvement; repeat comparable measurements or improve the measurement method |
| 0.30, 0.20, 0.10 after changing the evaluator | separate series; apparent improvement is confounded by the measurement change |

A window, slope, smoothing rule and acceptable noise must be selected from the
measurement process and task before inspecting the stopping decision. Preserve
raw observations next to any smoothing. Regression extrapolation is only a
conditional estimate; a few editorial scores do not establish achievability.
An upward quality trend does not obligate another iteration once the declared
criterion is met, and a good average never cancels a blocking negative test.

## Owner decision matrix

| Evidence state | Recommendation |
| --- | --- |
| Exact current artifact meets criteria, required evidence/authority present | close the specified claim; report scope |
| Criteria unmet, useful next experiment identified, budget and authority remain | continue with that experiment and predicted observation |
| Criteria unmet, next experiment not justified or observations conflict | hold and ask owner for a specific decision |
| Budget exhausted or authority missing | stop work and record what remains; no automatic extension |
| Unknown external effect or missing cancellation confirmation | reconcile the effect before retry or terminal-success reporting |
| Target/evaluator/output identity changes | start a new versioned assessment; preserve the old result |

The original documentation plateau and performance-budget examples are retained
as the third and fourth rows: describe the remaining gap, measurement limits,
possible intervention and requested owner decision. A monitor cannot authorize
accepting below a required threshold by calling it “acceptable with caveats.”

Record run/artifact revision, claim type, evaluator/criterion revision, raw
observations with timestamps, blockers, remaining budget, recommendation,
reason, alternative explanation and the next discriminating observation.
Replica equality, agent agreement and evidence of task correctness remain
separate fields. These examples are local teaching fixtures; the CRDT and CALM
sources do not prove numerical/editorial convergence or set these thresholds.
