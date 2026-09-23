# NodeBelief: Beta Posterior Over Pheromone Quality

`NodeBelief(alpha, beta)` is a conjugate Bayesian model for tracking the latent quality `p ∈ [0,1]` of a node — where "quality" means "probability that visiting this node yields a meaningful finding." The Beta distribution is the natural conjugate prior for Bernoulli observations, which is exactly what the agent generates: each visit produces a binary signal (found something / found nothing).

**Parameterization.** The prior is `Beta(1, 1)` — uniform over [0,1], encoding total ignorance. This is deliberate: no node is assumed to be valuable or worthless before evidence. Alpha accumulates "found" evidence; beta accumulates "nothing" evidence. Both start at 1, not 0, so the posterior is always proper (no division by zero, no degenerate point mass).

**Sufficient statistics for action selection.**

The two moments the EFE formula actually uses:

```
E[p]   = alpha / (alpha + beta)
Var[p] = (alpha * beta) / ((alpha + beta)^2 * (alpha + beta + 1))
```

`E[p]` drives the pragmatic term: go where you believe the payoff is high. `Var[p]` drives the epistemic term: go where you are most uncertain. Both are exact closed-form expressions — no Monte Carlo required. The denominator in `Var[p]` grows as `n^3` (where `n = alpha + beta` is the effective sample count), so variance collapses to zero as evidence accumulates. This is the mechanism by which exploration automatically switches off once a node is well-understood.

**Concrete numbers.** At initialization, `E[p] = 0.5`, `Var[p] = 1/12 ≈ 0.0833`. After 3 "found" and 0 "nothing" observations (with `learning_rate=1.0`): `alpha=4, beta=1`, giving `E[p] = 0.8`, `Var[p] = 4/(25*6) ≈ 0.0267`. After 5 "found" and 5 "nothing": `alpha=6, beta=6`, giving `E[p] = 0.5`, `Var[p] = 36/(144*13) ≈ 0.0192` — uncertainty is down 77% from baseline despite the agent having no directional belief about quality.

**Update rule.** Observations are hard-applied, not sampled:

```python
if found_something:
    belief.alpha += learning_rate   # default learning_rate = 1.0
else:
    belief.beta  += learning_rate
```

`learning_rate` scales how strongly each observation updates the posterior. At 1.0, each observation counts as one full data point. Values below 1.0 implement a form of discount/forgetting by making observations count for less than a full pseudo-observation. There is no time-decay in the base SOMA implementation — beliefs are persistent — so an agent that visited a node early and never returned retains that evidence permanently. This is appropriate for static graphs but may need modification for dynamic environments where node quality drifts.

**Social learning via pheromone.** The pheromone field provides a second update channel that does not require direct visitation:

```python
social_update = pheromone_concentration * social_learning_rate
belief.alpha += social_update   # pheromone is positive evidence
```

This is a soft Bayesian update: pheromone pushes the belief toward higher quality without committing a full binary observation. `social_learning_rate=0.1` means ten units of pheromone counts as one direct "found" observation. This couples the agent's private posterior to the collective's shared environmental signal without any direct agent-to-agent communication — the stigmergic principle applied to belief state.

**Surprise computation.** After updating, the agent computes the surprise of the observed outcome under the prior belief (before the update):

```python
p_prior = alpha_before / (alpha_before + beta_before)
surprise = -log(p_prior if found else (1 - p_prior))
```

This surprise feeds the precision-adaptation mechanism. Surprise at `ln(2) ≈ 0.693` is the neutral baseline — what a uniform Beta predicts. Higher surprise signals the model is poorly calibrated and should explore more (increase `w_epist`). Lower surprise signals the model is well-calibrated and should exploit more (increase `w_prag`).

## Key Points

- Beta(alpha, beta) initialized to Beta(1,1) per node; alpha counts "found," beta counts "nothing" with `learning_rate` scaling each increment
- `E[p] = alpha/(alpha+beta)` is used directly in the pragmatic EFE term; `Var[p] = alpha*beta/((alpha+beta)^2 * (alpha+beta+1))` is used in the epistemic term — both are closed-form, no sampling
- Variance collapses as O(1/n^2) in total observations n, so epistemic drive to visit a node decays automatically without any explicit schedule
- Social learning applies a fractional update to alpha from pheromone concentration, coupling private beliefs to the collective environment without agent-to-agent messaging
- Surprise = `-log p(outcome | prior belief)` feeds precision adaptation: high surprise → raise `w_epist`, low surprise → raise `w_prag`

## See Also

- `SKILL.md` §"Core Concepts" — how `E[p]` and `Var[p]` appear in `G(n)` formula
- `references/efe-decomposition.md` — how pragmatic and epistemic terms combine and how resolution damping modifies the pragmatic term
- `soma/generative_model.py` — `NodeBelief` dataclass and `GenerativeModel.update_belief()`, `compute_efe()`, `update_from_pheromone()`
