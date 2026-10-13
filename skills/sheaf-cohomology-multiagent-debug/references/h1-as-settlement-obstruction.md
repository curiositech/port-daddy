# Observed residuals are not settlement decisions

## Declared linear statistic

Given a stated finite map `delta_K:C0->C1(K)` and **independently observed** `g_K`, the least-squares distance

$$r=\min_x\|g_K-\delta_Kx\|$$

is the smallest correction in the stated norm needed to make the observations compatible with the chosen linear model. If `g_K=delta_Kx` is constructed from one assignment, then `r=0` identically. The observation model must distinguish asserted edge values from values derived from a shared assignment.

If the measurement model is `g_K=delta_Kx_*+epsilon`, then `r <= ||epsilon||` in that same norm because `x_*` is a feasible comparison point. This does not identify a source of error, establish a unique correction, or transfer to an unstated noise model.

## What zero and nonzero mean

| Algebraic result | Permitted statement | Not established |
| --- | --- | --- |
| `r=0` | observations are compatible with the stated linear model within tolerance | balance validity, nonnegativity, capacity, freshness, authenticity, no double spend, or permission to settle |
| `r>0` | no exact assignment matches all observed values in that model | cause, intent, faulty participant, attack, or a safe repair |

A nonzero residual can come from noise, stale versions, inconsistent units, incomplete visibility, an orientation error, or a restriction-map/model mismatch.

## Ranking is only a hypothesis generator

Residual support may guide a review: report the coordinates with largest `||rho_e||²` and the declared costs. A greedy `||rho_e||²/cost(e)` ordering is a local heuristic. It is not an optimal cut proof, does not show a selected edge caused the residual, and does not guarantee one step per cycle rank. Any ledger/settlement action must be governed and verified outside this reference.

## Constructed triangle

For the scalar oriented triangle `(01,12,02)`, `delta0=[[-1,1,0],[0,-1,1],[-1,0,1]]`. The independently supplied `g=(1,1,1)` has cycle sum `1+1-1=1`, so it is not in `im(delta0)`. This shows incompatibility with this orientation/model only. It does not describe a transaction system.
