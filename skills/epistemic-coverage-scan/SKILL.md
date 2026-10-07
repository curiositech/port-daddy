---
name: epistemic-coverage-scan
version: 0.1.0
description: >
  An innate exploratory drive that guarantees no graph node remains permanently
  invisible to an agent population. After a warm-up period (step > 3), each
  agent fires a coverage scan with probability |unseen_nodes| / |all_nodes|.
  When triggered, the agent teleports directly to the globally unseen node with
  the highest belief uncertainty, works it, and returns control to the normal
  action-selection loop. Probability is self-annealing: it starts near 1.0 when
  almost everything is unseen and decays toward 0.0 as coverage saturates,
  requiring no manual schedule. The mechanism is "innate" (hard-coded into the
  agent step loop) as distinct from the "adaptive" EFE path, which requires
  local neighbors and learned precision weights. Together they form a two-layer
  exploration architecture: adaptive for locally-guided foraging, innate for
  topological completeness.
author: soma-windags-graft
tags: [active-inference, exploration, coverage, epistemic, graph-traversal, multi-agent]
pairs-with: []
---

# Epistemic Coverage Scan

## When to Use

- Any multi-agent graph-traversal system where isolated or low-degree nodes risk
  being permanently skipped because no pheromone gradient points toward them.
- When EFE-driven (or any gradient-following) agents have converged locally and
  you need a backstop guarantee that the entire node set is eventually visited.
- When audit completeness matters — code review, security scans, dependency
  graphs — and a missed node is a missed vulnerability.

NOT for:
- Single-agent systems where the agent already maintains an explicit "to-visit"
  queue (a BFS/DFS frontier achieves the same guarantee deterministically).
- Dense, fully-connected graphs where every node is reachable via gradient
  within a few hops and isolation is structurally impossible.
- Real-time systems where a sudden long-range teleport disrupts locality
  assumptions in the surrounding architecture.

## Core Concepts

**Unseen set** — `{n : visit_counts[n] == 0 and n != current_position}`.
Maintained implicitly via `GenerativeModel.visit_counts`, a dict that is
incremented in `update_belief()` on every observation. An agent's unseen set
is agent-local; with social learning, multiple agents collectively saturate
coverage faster but each tracks its own frontier.

**Self-annealing scan probability** — `P_scan = |unseen| / |all_nodes|`.
No decay schedule parameter required. At initialization every node is unseen so
P_scan ≈ 1.0 (minus the agent's starting position). As visits accumulate the
probability falls monotonically. Once all nodes have been visited, |unseen| = 0
and the mechanism costs exactly zero probability mass per step.

**Warm-up gate** — scan is suppressed for `total_steps <= 3`. This prevents
premature teleportation before EFE has had enough observations to form
meaningful beliefs; the first few steps are spent seeding local beliefs via
normal gradient following.

**Innate vs adaptive layering** — The scan fires *before* the EFE action is
returned but *after* EFE has computed a local candidate. Priority order in
`_select_action()`:
  1. Adaptive: epistemic teleport (EFE below `teleport_threshold`, global
     uncertainty dominates local max by factor 1.5x).
  2. Innate: epistemic scan (unseen nodes exist, random draw beats P_scan,
     teleport to highest-uncertainty unseen node).
  3. Adaptive: EFE softmax over local neighbors (default path).

**Target selection within unseen set** — `max(unseen, key=lambda n: model.get_belief(n).uncertainty)`.
All unseen nodes share the same prior `Beta(1,1)` so their `uncertainty`
values are identical at first. Once social learning has pushed pheromone signals
into some priors, the argmax selects the structurally most-uncertain candidate
even before direct visit.

## Implementation Pattern

```
# Inside ActiveInferenceAgent._select_action(medium) — after EFE candidate
# is computed, before returning:

WARM_UP_STEPS = 3

if agent.total_steps > WARM_UP_STEPS:
    all_nodes  = list(medium.graph.nodes())
    unseen     = [n for n in all_nodes
                  if model.visit_counts.get(n, 0) == 0
                  and n != agent.position]

    if unseen:
        scan_prob = len(unseen) / max(len(all_nodes), 1)   # self-annealing
        if rng.random() < scan_prob:
            # Among unseen, prefer highest posterior uncertainty
            target = max(unseen, key=lambda n: model.get_belief(n).uncertainty)
            return target, "epistemic_scan"

# Fall through to EFE-selected candidate
return efe_candidate, "efe_<action_type>"
```

Exact source location: `soma/active_inference_agent.py` lines 203-214,
method `ActiveInferenceAgent._select_action(self, medium: Medium)`.

Key invariants to preserve when porting:
- The unseen filter must exclude `agent.position` (the agent is already there).
- `visit_counts` must be updated in `update_belief()`, not in `step()`, so
  social-learning pheromone updates do not increment counts.
- The `max(len(all_nodes), 1)` guard prevents ZeroDivisionError on empty graphs.
- Action label `"epistemic_scan"` is distinct from `"epistemic_teleport"` so
  callers can log and instrument the two paths separately.

Supporting signatures from `GenerativeModel` (`soma/generative_model.py`):

```python
# Belief retrieval — returns Beta(1,1) prior for unseen nodes
model.get_belief(node_id: str) -> NodeBelief
    # NodeBelief.uncertainty == Var[Beta(α,β)] = αβ / ((α+β)²(α+β+1))

# Visit tracking — called automatically inside update_belief()
model.visit_counts: Dict[str, int]   # {node_id: number_of_direct_observations}

# Novelty score (not used in scan target selection, used in EFE)
model.novelty(node_id: str) -> float  # 1 / (1 + visits)

# Global highest-uncertainty node (used by epistemic_teleport, not scan)
model.highest_uncertainty_node(exclude: Optional[set]) -> Optional[str]
```

## Key References

- Friston, K. (2010). The free-energy principle: a unified brain theory?
  *Nature Reviews Neuroscience*, 11(2), 127-138.
  — Foundational paper establishing epistemic foraging as free-energy minimization.

- Parr, T., & Friston, K. J. (2019). Generalised free energy and active inference.
  *Biological Cybernetics*, 113(5), 495-513.
  — Formalizes the innate vs adaptive distinction in active inference agents;
  epistemic scan maps to the "prior preference for information gain" term.

- Hansen, J. L., & Ghrist, R. (2021). Opinion dynamics on discourse sheaves.
  *SIAM Journal on Applied Mathematics*, 81(5), 2033-2060.
  — Convergence proof for sheaf Laplacian diffusion on graphs; establishes why
  gradient-following alone fails on disconnected components (motivates innate scan).

- SOMA `soma/active_inference_agent.py` — Reference implementation.
  `ActiveInferenceAgent._select_action()` lines 203-214; `GenerativeModel`
  (`soma/generative_model.py`) for `visit_counts`, `get_belief()`, `novelty()`.
