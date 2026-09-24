---
name: stigmergic-diffusion-medium
version: 0.1.0
description: >
  A graph-based shared blackboard where agents coordinate indirectly by depositing
  typed pheromone traces (PHEROMONE, BELIEF, PREFERENCE, ANTIBODY, RESOLUTION) onto
  graph nodes, then sensing and following concentration gradients. Traces spread via
  a stated scalar graph update and decay, creating a lossy attention field. It can
  prioritize inspection; it does not replace reliable messaging, assignment, delivery,
  coverage, or completion evidence.
author: soma-jury_rig-graft
tags: [stigmergy, multi-agent, coordination, diffusion, graph, blackboard, active-inference, pheromone]
pairs-with: [active-inference-agent, belief-market-tateonnement, immune-selection-pressure]
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  provenance:
    kind: imported
    source: workgroup-ai / jury_rig skill library (rehomed 2026-07-04)
---

# Stigmergic Diffusion Medium

## When to Use

- You need agents to coordinate without direct messaging: no queues, no RPC, no shared
  mutable state beyond the medium itself. Agents write traces; other agents sense them.
- Your problem maps naturally onto a graph (import dependency graph, task DAG, knowledge
  graph, file system, network topology) and agents need to discover high-value nodes by
  following concentration signals rather than being assigned work.
- You want emergent load balancing and exploration: resolution traces dampen overcrowded
  nodes; urgency amplification surfaces deadline pressure; antibody traces suppress
  already-solved sub-problems — all without a scheduler.

NOT for:
- Hard real-time coordination where sub-millisecond synchronization is required (diffusion
  physics introduce lag proportional to graph diameter).
- Problems where agents must exchange structured messages with guaranteed delivery — the
  medium is a lossy signal field, not a reliable message bus.
- Flat, unstructured data with no natural graph topology; forcing one creates spurious
  gradient artifacts.


## Core Concepts

**Trace** (`Trace` dataclass): A single stigmergic deposit with fields `trace_type`,
`intensity`, `depositor`, `created_at`, optional `deadline`/`urgency_alpha`/`urgency_beta`
for temporal pressure, and optional `confidence_stake`/`proposition` for belief-market
extension. The fundamental write unit.

**TraceType** (enum): Five distinct "goods" in the wide-market framework —
`PHEROMONE` (work-in-progress / distress), `BELIEF` (probabilistic claims),
`PREFERENCE` (Active Inference priors, desired future states), `ANTIBODY`
(known-bad / already-solved patterns, triggers negative selection), `RESOLUTION`
(anti-inflammatory: suppresses agent activity at a node after a problem is closed).

**Scalar diffusion is an attention heuristic**: For the stated synchronous,
unweighted, undirected update, `p_next = (I - alpha*h*L)p` with `L = D-A` ranks
nearby candidates for inspection. It does not assign an owner, route a request,
prove coverage, prevent duplicate work, or prove a resolution; each requires a
separate authority and evidence protocol.

**Pheromone gradient** (`gradient(node_id)`): The discrete exterior derivative of the
pheromone 0-cochain restricted to the star of a vertex:
`{neighbor: p_neighbor - p_self}`. Positive values attract; agents climb the gradient
toward higher concentrations. This is the only mechanism agents need to follow crowd
wisdom without knowing who deposited what.

**Resolution damping**: `sense()` returns *effective* pheromone =
`raw_pheromone * max(0, 1 - resolution_damping * resolution_level)`. Depositing a
`RESOLUTION` trace at a node makes it appear less attractive to new agents — the
anti-inflammatory that prevents pile-on after a problem is solved.


## Implementation Pattern

```python
# 1. Construct the medium (all randomness seeded for determinism)
medium = Medium(
    decay_rate=0.01,          # γ: exponential decay per tick
    diffusion_rate=0.005,     # α: Laplacian diffusion coefficient
    resolution_damping=0.5,   # how strongly RESOLUTION traces suppress activity
    rng_seed=42,
)

# 2. Build topology (or import from repo_parser.py for code-review domains)
medium.add_node("auth/login.py")
medium.add_node("utils/crypto.py")
medium.add_edge("auth/login.py", "utils/crypto.py")

# 3. Agent deposits a trace after visiting a node
medium.deposit(
    node_id="auth/login.py",
    agent_id="agent-0",
    intensity=1.0,
    trace_type=TraceType.PHEROMONE,
    deadline=medium.time + 10,  # optional temporal urgency
)

# 4. Agent senses neighborhood before choosing next move
signals = medium.sense("auth/login.py", radius=1)
# → {"auth/login.py": 0.9, "utils/crypto.py": 0.1}  (resolution-damped)

grad = medium.gradient("auth/login.py")
# → {"utils/crypto.py": -0.8}  # climb toward higher concentration

# 5. Advance physics each simulation step
diagnostics = medium.tick(dt=1.0)
# Returns: {time, total_pheromone, distress_nodes, max_pheromone}
# tick() handles: decay → diffusion (stability-clamped) → urgency boost → prune epsilon

# 6. After solving a node, deposit RESOLUTION to prevent pile-on
medium.deposit("auth/login.py", "agent-0", intensity=2.0,
               trace_type=TraceType.RESOLUTION)

# 7. Antibody negative selection: skip if already solved
if not medium.check_antibody(pattern_signature=hash_of_problem):
    do_work()
    medium.deposit(node_id, agent_id, 1.0, TraceType.ANTIBODY,
                   pattern_signature=hash_of_problem)

# 8. Observability
medium.hotspots(n=5)          # top-5 nodes by pheromone
medium.snapshot()              # full state dict for visualization
medium.global_uncertainty_map()  # {node: uncertainty_proxy} for Active Inference seeding
medium.preference_field()      # {node: total PREFERENCE intensity} for implicit coordination
medium.freeze_baseline()       # capture normal operating state
medium.deviation_from_baseline(node_id)  # novelty signal above baseline
```

**Physics tick order** (from `Medium.tick()`):
1. Exponential decay: `p *= exp(-γ dt)`
2. Resolution decay (faster): `r *= exp(-2γ dt)`
3. Laplacian diffusion with clamped `dt_eff`
4. Urgency amplification for traces with `deadline` set
5. Prune values below `1e-8`

**Numerical boundary:** `h <= 1/(alpha*d_max)` is a sufficient non-negative
update bound for the stated operator when `d_max > 0`; `0.9/(alpha*d_max)` is a
conservative safety factor, not a proof for weighted, directed, normalized,
asynchronous, saturated, or concurrently mutated graphs. Pure synchronous
diffusion preserves scalar mass; decay, pruning, and deposits do not. See
[`references/operator-contract-and-limits.md`](references/operator-contract-and-limits.md).

The diagrams make the operational boundaries explicit: [a trace is a candidate
signal, not a completion receipt](diagrams/02_trace-lifecycle.md), and
[disconnected components do not exchange field influence](diagrams/03_topology-boundary.md).


## Key References

- Hansen & Ghrist (2021). "Opinion Dynamics on Discourse Sheaves." *SIAM Journal on
  Applied Mathematics.* Proves convergence of sheaf Laplacian dynamics; the scalar
  pheromone diffusion here is the constant-sheaf special case.

- Riess & Hale (2025). "Distributed Multi-agent Coordination over Cellular Sheaves."
  arXiv:2510.00270. Async-first sheaf diffusion; justifies `tick(dt)` accepting
  explicit time steps for heterogeneous agent cadences.

- Friston (2010). "The free-energy principle: a unified brain theory?" *Nature Reviews
  Neuroscience* 11, 127–138. Foundation for Active Inference agents that consume the
  medium's `global_uncertainty_map()` and `preference_field()` outputs.

- Howkins (2026). `soma/medium.py` — SOMA Week 1 reference implementation. All function
  signatures, parameter defaults, and physics are canonical from this file.
  `/Users/erichowens/coding/soma/soma/medium.py`
