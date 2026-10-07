# Friston (2010) Free-Energy Principle: From Surprise Minimization to EFE

The free-energy principle (FEP) is a normative theory of self-organizing biological systems. Its core claim: any system that maintains its structural integrity over time must implicitly minimize the *surprise* (negative log-likelihood) of its sensory observations. Directly minimizing surprise is intractable because it requires integrating over all possible hidden states. Friston's 2010 NRN paper shows that minimizing variational free energy — a tractable upper bound on surprise — achieves the same result.

**Variational free energy** is defined as:

```
F = KL[ q(s) || p(s|o) ] - log p(o)
  = E_q[ log q(s) - log p(o,s) ]
```

where `q(s)` is the agent's approximate posterior over hidden states `s`, and `p(o,s)` is the agent's generative model of how states produce observations `o`. Since `KL ≥ 0`, we have `F ≥ -log p(o)` — free energy upper-bounds surprise. Minimizing `F` over `q` tightens this bound (making `q` a better posterior); minimizing `F` over actions reduces the surprise of future observations (the agent moves to states it already believes in).

This dual role — perception as posterior inference, action as self-fulfilling prophecy — is the core novelty over classic reinforcement learning: there is no separate reward function. Preferences are encoded in the prior `p(o)` (a prior over desired observations), and the agent acts to make sensory data consistent with that prior.

**KL divergence as the loss.** The KL term `KL[q||p]` measures how much the agent's beliefs diverge from its generative model. A well-calibrated agent has `q ≈ p(s|o)` and `KL → 0`, meaning it is not surprised by what it sees. An agent encountering a novel state has high KL, high `F`, and a strong gradient driving belief update (perception) or environment change (action).

**From FEP to Expected Free Energy (EFE).** The FEP handles the *present*. Extending to *future states* requires asking: which action minimizes free energy over the trajectory, not just the current observation? This is EFE, formalized in Friston et al. (2015, 2017) and the Da Costa (2020) synthesis:

```
G(π) = E_q[ log q(s_τ|π) - log p(o_τ, s_τ) ]
      ≈  KL[ q(s_τ|π) || p(s_τ|o*) ]   [pragmatic: goal-directedness]
       + H[ p(o_τ|s_τ) ]_q              [epistemic: information gain]
```

The **pragmatic** term penalizes policies that lead to states far from the prior over preferred observations — it is the exploitation signal. The **epistemic** term (expected information gain, or negative expected entropy of the likelihood) rewards policies that resolve uncertainty about hidden states — it is the exploration signal. Both fall out of the same variational objective with no auxiliary design choices.

In the SKILL.md discrete-node implementation, this collapses to:

```
G(n) = w_prag * (-E[p_n] * damping) + w_epist * (-Var[p_n] * novelty(n))
```

`E[p_n]` is the pragmatic signal (Beta mean ≈ how rewarding node n is expected to be). `Var[p_n]` is the epistemic signal (Beta variance ≈ how much belief would be updated by visiting n). The negative signs make lower `G` more attractive, matching the minimization framing. `novelty(n) = 1/(1 + visits)` is a visit-count discount that prevents the epistemic term from driving infinite revisitation of nodes already resolved.

**Precision weighting implements attention.** Friston & Kiebel (2009) show that the relative weight between pragmatic and epistemic terms — here `w_prag / w_epist` — corresponds to precision (inverse variance) of the prior. High precision on preferences → exploitation. High precision on likelihoods → exploration. The adaptive precision mechanism in `GenerativeModel.adapt_precision()` implements this: it tracks recent surprise against the `ln(2) ≈ 0.693` neutral threshold (the surprise of a uniform Beta given either outcome) and shifts `w_prag`/`w_epist` accordingly.

**Why `ln(2)` is the neutral threshold.** A `Beta(1,1)` prior — maximum ignorance — has entropy `ln(2)`. A single observation from this prior produces surprise `≈ ln(2)` regardless of outcome. This is the baseline "expected surprise when you know nothing." If recent surprise consistently exceeds `ln(2)`, the agent is being surprised by its environment — evidence that the model is miscalibrated and exploration should increase.

## Key Points

- The FEP replaces reward maximization with surprise minimization: preferred states are encoded as prior beliefs, and action is inference over how to make observations match those priors.
- EFE decomposes into pragmatic (exploit: go where beliefs predict reward) and epistemic (explore: go where uncertainty can be resolved) terms — both derived from the same variational bound, not hand-combined heuristics.
- In the Beta distribution implementation, `E[p_n]` drives pragmatic value and `Var[p_n]` drives epistemic value; no separate reward or curiosity signal is needed.
- The `ln(2) ≈ 0.693` neutral surprise threshold (entropy of uniform Beta) is the correct adaptive precision pivot point, not an arbitrary hyperparameter.
- Softmax over `-gamma * G` is the natural decision rule: it is the Boltzmann distribution over free energy, and `gamma` (inverse temperature) controls how sharply the agent commits to the EFE minimum.

## See Also

- `SKILL.md` — Full implementation pattern: `GenerativeModel`, `NodeBelief`, `compute_efe()`, `adapt_precision()`; validated benchmark numbers (50% → 100% completion rate on SOMA Week 2).
- Parr & Friston (2019), "Generalised free energy and active inference," *Biological Cybernetics* — Policy-level EFE and the relationship between precision-weighting and attention; closest theoretical bridge from FEP to the SOMA implementation.
- Da Costa et al. (2020), "Active inference on discrete state-spaces," *Journal of Mathematical Psychology*, 99: 102447 — Discrete-state formulation; directly implements the Beta-distribution belief updates and softmax policy used here.
