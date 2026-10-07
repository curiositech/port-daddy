# EFE Computation: Formula, Softmax Selection, and Precision Adaptation

The SOMA generative model computes Expected Free Energy as a scalar score per candidate node, then selects an action via softmax. The formula is:

```
G(n) = w_prag · (−E[p_n] · damping(n)) + w_epist · (−Var[p_n] · novelty(n))
```

Both terms are negative, so G is negative. More negative G = more attractive. The pragmatic term drives exploitation: E[p_n] = α/(α+β) is the mean of the Beta belief at node n. Higher expected bug probability makes that node more attractive. The resolution damping factor `damping(n) = max(0, 1 − res_damping · res_n)` suppresses nodes where RESOLUTION traces are already high (typically res_damping=0.5). A fully resolved node (res_n=1.0) gets pragmatic value halved; a heavily resolved node saturates near zero.

The epistemic term drives exploration: Var[p_n] = αβ/((α+β)²(α+β+1)) is the variance of the Beta distribution — maximum at α=β=1 (prior, 0.25), collapsing toward zero with observations. Multiplied by novelty(n) = 1/(1 + visit_count(n)), this penalizes both well-understood nodes AND frequently visited ones. A node with two visits and posterior Beta(3,1) has lower epistemic pull than an unvisited node with the same belief shape.

**Softmax selection** (`generative_model.py:207`): the agent computes G(n) for each neighbor, then samples from:

```
π(n) = softmax(−γ · G(n))   where γ = 4.0 (default)
```

The negation flips the sign so that more negative G produces a larger logit. Max-subtraction for numerical stability is applied before exponentiation. γ = 4.0 is not hardcoded dogma — it is a precision parameter that controls how peaked the distribution is. At γ→0, action is uniform random. At γ→∞, the agent always picks argmin G. At γ=4, moderate stochasticity remains, which is important for the multi-agent setting where deterministic routing would cause pile-ups.

**Precision adaptation** (`generative_model.py:246`): after every observation, surprise = −log p(obs | belief) is appended to a sliding window of length 20. If mean surprise over the window exceeds 0.693 (= −log 0.5, the surprise of a uniform prior being wrong), w_epistemic increases by precision_adapt_rate (default 0.05) and w_pragmatic decreases by half that. If mean surprise is below 0.693, the reverse. This implements self-tuning: an agent encountering many unexpected outcomes (poor model fit) automatically shifts toward epistemic behavior to gather more data before committing. The adaptation is slow by design (rate=0.05) — it damps oscillation.

**Default weight initialization**: w_pragmatic=1.0, w_epistemic=1.5. The epistemic weight starts higher because in the early steps of a traversal, belief variance dominates — almost all nodes are at the Beta(1,1) prior. As observations accumulate, variance shrinks and pragmatic value (non-zero expected values for nodes with confirmed bugs) takes over naturally. Inverting this initialization (w_prag > w_epist at start) would cause the agent to exploit its prior immediately, which in a coverage task is catastrophically myopic.

**Social learning** (`generative_model.py:128`): pheromone deposits from other agents shift beliefs before EFE is computed. Normalized pheromone at node n increments α by social_learning_rate × normalized_pheromone. This means high pheromone density raises E[p_n] and lowers Var[p_n] for that node — it becomes more attractive pragmatically AND less attractive epistemically. The net effect depends on current weights, but generally: high-pheromone nodes look like "hot" exploitable targets, while novel low-pheromone nodes remain the epistemic attractors.

## Key Points

- G(n) is always negative; more negative = more attractive. The softmax negates it again (−γG) so larger magnitudes → larger probability.
- The resolution damping in the pragmatic term is a one-sided gate: it suppresses attraction to already-solved areas without creating repulsion (never negative contribution).
- novelty(n) = 1/(1 + visits) decays harmonically, not exponentially — a node visited twice has half the novelty of an unvisited node, not near-zero. This keeps epistemically valuable revisits possible.
- Precision self-adaptation uses a fixed neutral point (0.693) based on the Beta(1,1) prior, not a learned threshold. This is intentional: the reference surprise is the agent's own ignorance baseline.
- γ=4.0 produces meaningful stochasticity at the scale of typical neighbor sets (3-8 nodes). If the graph has very high-degree hubs, consider tuning γ downward to prevent winner-takes-all dynamics.

## See Also

- `soma/active_inference_agent.py` — how `select_action` and `adapt_precision` are called per step, and how epistemic teleportation overrides normal EFE selection
- `soma/medium.py` — RESOLUTION trace semantics and how `resolution_map` passed into `compute_efe` is computed from the Medium snapshot
- Friston (2010) "The free-energy principle: a unified brain theory?" — theoretical grounding for the pragmatic/epistemic decomposition of G
