---
name: expected-free-energy-action-selection
version: 0.1.0
description: >
  Principled action selection for autonomous agents using Expected Free Energy
  (EFE) under the Active Inference framework. Each candidate action is scored
  as G(n) = w_prag * (-E[p_n] * damping) + w_epist * (-Var[p_n] * novelty(n)),
  where agent beliefs are maintained as per-node Beta distributions and
  updated via Bayesian observation. Selection is a softmax over -gamma * G,
  making exploration an automatic consequence of uncertainty rather than a
  hardcoded epsilon. Precision weights w_prag and w_epist self-adapt via
  surprise history, shifting the agent between exploitation and exploration
  regimes without any manually tuned schedule.
author: soma-windags-graft
tags: [active-inference, free-energy, exploration, agent, bayesian, reinforcement-learning, stigmergy]
pairs-with: []
---

# Expected Free Energy Action Selection

## When to Use

- An agent must choose among candidate next-states without a fixed reward function, where exploration and exploitation must both emerge naturally from the agent's own uncertainty.
- You are replacing epsilon-greedy, UCB, or Thompson-sampling heuristics with a principled Bayesian alternative whose exploration drive vanishes automatically as knowledge accumulates.
- Agents operate in a shared environment (stigmergic medium, graph, map) and can incorporate social signals (pheromone, shared traces) as a second belief-update channel.

NOT for:
- Bandit problems with i.i.d. rewards and no spatial structure — simpler Thompson sampling is sufficient there.
- Environments where the state space is continuous and high-dimensional; this formulation assumes discrete nodes with tractable per-node Beta posteriors.
- Settings requiring hard guarantees on regret bounds; EFE is principled but does not come with PAC or UCB-style worst-case guarantees.

## Core Concepts

**Beta distribution belief per node.**
Each node n carries a belief `NodeBelief(alpha, beta)` initialised to `Beta(1, 1)` (maximum ignorance). After visiting n and observing a binary outcome (found something / found nothing), the posterior updates:
- found: `alpha += learning_rate`
- nothing: `beta += learning_rate`

This gives `E[p_n] = alpha / (alpha + beta)` and `Var[p_n] = alpha*beta / ((alpha+beta)^2 * (alpha+beta+1))`.

**Expected Free Energy G(n).**
The scalar the agent minimises when choosing where to go next:

```
G(n) = w_prag * pragmatic(n) + w_epist * epistemic(n)

pragmatic(n)  = -E[p_n] * max(0, 1 - resolution_damping * res_n)
epistemic(n)  = -Var[p_n] * novelty(n)
```

Lower (more negative) G means more attractive. The pragmatic term rewards going where the agent believes something rewarding will be found, damped by a resolution signal that prevents pile-on. The epistemic term rewards going where uncertainty is highest and the node is undervisited.

**Softmax action selection with inverse temperature gamma.**
Candidates are ranked by `softmax(-gamma * G(n))`. Higher gamma sharpens the distribution toward the EFE minimum; lower gamma makes selection nearly uniform. This is *not* epsilon-greedy: the exploration probability is a smooth function of the belief state, not a hyperparameter.

**Precision adaptation.**
After each observation the agent records surprise `S = -log p(outcome | belief)`. A sliding window mean of recent surprise is compared to the neutral threshold `ln(2) ≈ 0.693` (surprise of a uniform Beta observing either outcome). High mean surprise increases `w_epist` (explore more); low mean surprise increases `w_prag` (exploit more). The weights therefore track whether the model is currently well-calibrated.

**Epistemic scan and epistemic teleportation.**
Two mechanisms that prevent local optima from hiding globally unseen nodes:
- *Epistemic scan* (step > 3): with probability `len(unseen) / total_nodes`, jump to the highest-uncertainty unseen node. Probability decays to zero once all nodes have been visited at least once.
- *Epistemic teleportation* (triggered when max |EFE| of all local neighbors < `teleport_threshold`): jump globally to the node with the highest `Var[p] * novelty` score, but only if it is 1.5x more informative than the best local neighbor.

## Implementation Pattern

The following pseudocode maps directly onto the SOMA implementation in `soma/generative_model.py` and `soma/active_inference_agent.py`.

```python
# ---- Per-agent initialisation ----
model = GenerativeModel(
    w_pragmatic=1.0,          # exploit weight (self-adapting)
    w_epistemic=1.5,          # explore weight (self-adapting)
    gamma=4.0,                # softmax inverse temperature
    learning_rate=1.0,        # Beta update step size
    social_learning_rate=0.1, # pheromone → belief transfer rate
    precision_adapt_rate=0.05,
    rng_seed=seed,
)

# ---- Per step ----
def step(agent, medium):
    # 1. Social learning: pheromone updates beliefs before deciding
    neighborhood = medium.sense(agent.position, radius=receptive_radius)
    model.update_from_pheromone(neighborhood, max_pheromone=max(neighborhood.values()))

    # 2. Compute EFE for each neighbor
    neighbors = list(graph.neighbors(agent.position))
    resolution_map = {n: medium.resolution.get(n, 0.0) for n in neighbors}

    efe_scores = {
        n: model.compute_efe(n, resolution_map[n], resolution_damping)
        for n in neighbors
    }

    # 3. Softmax selection
    #    select_action() returns (selected_node, action_type, efe_scores)
    selected, action_type, _ = model.select_action(
        neighbors=neighbors,
        resolution_map=resolution_map,
        resolution_damping=medium.resolution_damping,
    )

    # 4. Epistemic scan: stochastic jump to unseen nodes
    #    Implemented inside _decide_move() in ActiveInferenceAgent:
    #    scan_prob = len(unseen) / len(all_nodes)
    #    if rng.random() < scan_prob: target = highest-uncertainty unseen node

    # 5. Move, do work, observe
    agent.position = selected
    outcome = do_work(selected)     # returns {found_something: bool, quality: float}

    # 6. Bayesian belief update
    surprise = model.update_belief(selected, outcome["found_something"])
    # found_something=True  → alpha += 1
    # found_something=False → beta  += 1

    # 7. Precision adaptation (after each step)
    model.adapt_precision()
    # High recent surprise → w_epist up, w_prag down
    # Low  recent surprise → w_prag up, w_epist down

# ---- EFE formula (from GenerativeModel.compute_efe) ----
def compute_efe(node_id, resolution_level, resolution_damping):
    belief = model.get_belief(node_id)
    damping  = max(0.0, 1.0 - resolution_damping * resolution_level)
    pragmatic = -belief.expected_value * damping          # exploit
    epistemic = -belief.uncertainty * model.novelty(node_id)  # explore
    return w_pragmatic * pragmatic + w_epistemic * epistemic

# ---- Novelty (inverse visit count) ----
def novelty(node_id):
    visits = visit_counts.get(node_id, 0)
    return 1.0 / (1.0 + visits)     # 1.0 for unvisited, decays toward 0

# ---- Softmax (from GenerativeModel.select_action) ----
values = np.array([-gamma * efe_scores[n] for n in neighbors])
values -= values.max()              # numerical stability
probs  = np.exp(values) / np.exp(values).sum()
selected = rng.choice(neighbors, p=probs)

# ---- Cloning with mutation (immune selection hook) ----
child_model = model.clone(mutation_scale=0.1, rng_seed=seed)
# Inherits beliefs and visit_counts; mutates w_pragmatic, w_epistemic, gamma
```

**Default hyperparameters (SOMA Week 2, validated on 20-trial benchmark):**

| Parameter | Default | Effect of increasing |
|---|---|---|
| `w_pragmatic` | 1.0 | More exploitation of known-good nodes |
| `w_epistemic` | 1.5 | More exploration of uncertain nodes |
| `gamma` | 4.0 | Sharper selection toward EFE minimum |
| `learning_rate` | 1.0 | Faster belief update per observation |
| `social_learning_rate` | 0.1 | More influence from neighbors' pheromone |
| `teleport_threshold` | 0.01 | Fewer epistemic teleports |
| `precision_adapt_rate` | 0.05 | Faster precision weight drift |

**Benchmark result:** switching from epsilon-greedy (Week 1) to EFE action selection (Week 2) raised task-completion rate from 50% to 100% across 20 trials and closed the isolated-node coverage gap entirely via the epistemic scan mechanism.

## Key References

- Friston, K. (2010). "The free-energy principle: a unified brain theory?" *Nature Reviews Neuroscience*, 11(2), 127–138. — Foundational derivation of EFE from variational inference; establishes the pragmatic/epistemic decomposition.
- Parr, T., & Friston, K. (2019). "Generalised free energy and active inference." *Biological Cybernetics*, 113(5–6), 495–513. — Extends EFE to policy selection; shows how precision-weighting implements attention.
- Da Costa, L., Parr, T., Sajid, N., Veselic, S., Neacsu, V., & Friston, K. (2020). "Active inference on discrete state-spaces: A synthesis." *Journal of Mathematical Psychology*, 99, 102447. — Practical discrete-state formulation closest to this implementation.
- SOMA `soma/generative_model.py` + `soma/active_inference_agent.py` — Reference implementation: `GenerativeModel`, `NodeBelief`, `ActiveInferenceAgent`. Key entry-points: `compute_efe()`, `select_action()`, `update_belief()`, `adapt_precision()`, `highest_uncertainty_node()`.
