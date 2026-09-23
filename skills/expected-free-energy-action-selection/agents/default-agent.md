# Default Agent Template: expected-free-energy-action-selection

## Node Definition

```yaml
id: efe-action-selection-agent
skill: expected-free-energy-action-selection
input:
  candidate_nodes: list of node IDs the agent may move to next
  belief_state: per-node Beta(alpha, beta) posteriors from prior steps (or null for first step)
  resolution_map: per-node resolution damping level (0.0–1.0; 0.0 if unavailable)
  pheromone_neighborhood: pheromone trace values for nodes in sensing radius
  step_index: current step number (integer, used to gate epistemic scan)
  visit_counts: per-node visit history (used for novelty computation)
output:
  selected_node: the node the agent moves to
  updated_beliefs: posterior Beta parameters for every visited or observed node
  efe_scores: raw G(n) values for all candidates (for logging/debugging)
  action_type: one of [local_efe, epistemic_scan, epistemic_teleport]
  precision_weights: updated w_pragmatic and w_epistemic after precision adaptation
```

## Prompt Template

You are an Active Inference agent selecting your next action from the candidate nodes `{{candidate_nodes}}`. Your current belief state is `{{belief_state}}` (Beta distributions per node; initialize to Beta(1,1) for any unvisited node). Resolution damping levels are `{{resolution_map}}` and your pheromone neighborhood reads `{{pheromone_neighborhood}}`.

First, apply social learning: for each node in the pheromone neighborhood, shift its Beta posterior toward the observed pheromone level at rate 0.1. Then compute the Expected Free Energy G(n) = w_pragmatic * (-E[p_n] * damping(n)) + w_epistemic * (-Var[p_n] * novelty(n)) for every candidate in `{{candidate_nodes}}`, where novelty(n) = 1 / (1 + visit_counts[n]). Select a node by drawing from softmax(-4.0 * G) — if step_index `{{step_index}}` > 3 and unseen nodes remain, apply the epistemic scan rule first (jump to highest-uncertainty unseen node with probability len(unseen)/len(all_nodes)). Return the selected node, all EFE scores, the action type, and the updated belief state and precision weights after calling adapt_precision() on the observation surprise.

## Success Criteria

- `selected_node` is always a member of `{{candidate_nodes}}` or a valid unseen node reached via epistemic scan/teleport — never an out-of-range node.
- After `total_nodes` steps, `visit_counts` shows no node with zero visits (full coverage guaranteed by epistemic scan decay).
- `precision_weights` drift toward w_epist > w_prag during high-surprise phases and reverse during low-surprise phases, confirmed by checking that the surprise window mean crosses ln(2) ≈ 0.693 as the boundary.
