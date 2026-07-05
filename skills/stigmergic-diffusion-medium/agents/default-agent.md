# Default Agent Template: stigmergic-diffusion-medium

## Node Definition

```yaml
id: stigmergic-medium-agent
skill: stigmergic-diffusion-medium
input:
  graph_nodes: list of node IDs (e.g. file paths, task names, concept keys)
  graph_edges: list of [source, target] pairs defining topology
  agent_id: string identifier for this agent instance
  start_node: node ID where this agent begins
  urgency_seeds: optional list of {node_id, intensity, deadline_ticks} for pre-seeded pressure
  decay_rate: float, default 0.01 — exponential pheromone decay per tick
  diffusion_rate: float, default 0.005 — Laplacian spread coefficient
  resolution_damping: float, default 0.5 — suppression strength after a node is resolved
  rng_seed: integer for reproducible runs
output:
  visited_nodes: ordered list of node IDs this agent processed
  findings: list of {node_id, result, confidence} produced by the agent's work function
  resolution_deposits: list of {node_id, intensity} placed after each successful visit
  final_medium_snapshot: full pheromone/resolution state dict at run end
```

## Prompt Template

You are a stigmergic coordination agent operating on a shared diffusion medium. The medium is a graph with nodes `{{graph_nodes}}` and edges `{{graph_edges}}`; pheromone concentrations spread via Laplacian diffusion (decay_rate={{decay_rate}}, diffusion_rate={{diffusion_rate}}) and you must navigate it without any direct messages from other agents — coordination happens only through the traces you and they deposit. Starting from node `{{start_node}}`, at each step: call `medium.sense(current_node, radius=1)` and `medium.gradient(current_node)` to read the signal field; move to the neighbor with the highest positive gradient (break ties toward lower degree to avoid hub pile-on), or explore randomly if all gradients are flat; perform your work function on the current node, then deposit a `PHEROMONE` trace with intensity 1.0 to signal activity; if your work yields a completed result, immediately deposit a `RESOLUTION` trace with intensity 2.0 so downstream agents are repelled. Before starting work on any node, check `medium.check_antibody(pattern_signature)` and skip if it returns True — that node's problem class is already solved. Continue for `{{max_steps}}` ticks or until all nodes have been visited, whichever comes first, and return your findings along with the final medium snapshot.

## Success Criteria

- Every node in `graph_nodes` is visited at least once across the full agent fleet within `max_steps` ticks, with no node receiving duplicate work (verified by antibody check firing on repeated visits).
- Resolution traces suppress revisitation: after an agent deposits `RESOLUTION` at a node, no other agent moves there in the subsequent 3 ticks (confirmed by examining `final_medium_snapshot` gradient values at that node).
- Euler stability holds throughout: no pheromone value in `final_medium_snapshot` exceeds 1e4, confirming `Medium.tick()` clamped `dt_eff` correctly on high-degree hubs.
