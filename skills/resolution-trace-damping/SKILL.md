---
name: resolution-trace-damping
version: 0.1.0
description: >
  Resolution-trace damping is an anti-inflammatory mechanism for stigmergic
  multi-agent systems: after an agent solves a problem at a node, it deposits
  a RESOLUTION trace there. Subsequent sense() calls at that node return a
  damped effective pheromone — effective = raw * (1 - resolution_damping * res)
  — so other agents are repelled proportionally to how thoroughly the node is
  resolved. This prevents computational autoimmune disease: the failure mode
  where all agents converge on already-solved hotspots while unsolved nodes
  starve. The mechanism is local, stateless from the agent's perspective, and
  requires no coordinator — it is purely stigmergic.
author: soma-windags-graft
tags: [stigmergy, multi-agent, coordination, soma, anti-inflammatory, pheromone]
pairs-with: []
---

# Resolution-Trace Damping

## When to Use

- An agent has finished meaningful work at a node (bug fixed, file reviewed,
  task completed) and should signal to peers that continued attention is
  wasteful.
- You observe pile-on: multiple agents redundantly revisiting high-pheromone
  nodes while low-pheromone nodes remain unvisited — a positive-feedback loop
  that reads like an autoimmune flare.
- You need distributed work-spreading with no central scheduler; the damping
  field acts as a self-regulating pressure gradient across the problem graph.

NOT for:
- Nodes that are only partially resolved — deposit at reduced intensity, not
  full resolution, to preserve residual gradient.
- Suppressing genuinely urgent re-work (regressions, cascading failures); pair
  with deadline-carrying PHEROMONE traces whose urgency overrides the damping.
- Replacing the antibody mechanism: ANTIBODY traces block known-bad patterns
  globally; RESOLUTION traces suppress local activity after local completion.
  They are complementary, not synonyms.

## Core Concepts

**RESOLUTION trace** — a `Trace` with `trace_type=TraceType.RESOLUTION`.
Depositing one accumulates into `Medium.resolution[node_id]` (a float) rather
than `Medium.pheromone[node_id]`. Resolution level does not diffuse along
edges; it is strictly local to the node where it was deposited.

**resolution_damping (d)** — a scalar hyperparameter on `Medium`
(constructor default: `0.5`). Controls how strongly a unit of resolution
suppresses raw pheromone. At `d=0` the mechanism is disabled; at `d=1` a
resolution level of 1.0 zeroes out the raw signal entirely.

**Effective pheromone** — the signal an agent actually perceives when calling
`Medium.sense()`. Formula:

    effective(n) = raw(n) * max(0.0, 1 - d * res(n))

where `raw(n) = Medium.pheromone[n]` and `res(n) = Medium.resolution[n]`.
The `max(0.0, ...)` clamp prevents sign inversion when `d * res > 1`.

**Gradient following** — agents navigate by comparing effective pheromone
across neighbors, not raw pheromone. Resolution-heavy nodes simply look less
attractive, so the natural gradient walk steers agents away without any
explicit routing logic.

**Computational autoimmune disease** — the failure mode this mechanism
prevents. In unchecked stigmergic systems, pheromone is self-reinforcing:
more work deposits more trace, which attracts more agents, which deposit more
trace. Solved nodes become hyper-attractive; unsolved nodes are permanently
invisible. Resolution damping acts as anti-inflammation: it inverts the
feedback at completion.

## Implementation Pattern

```python
# 1. Constructor — tune resolution_damping at Medium init time
medium = Medium(
    decay_rate=0.01,
    diffusion_rate=0.005,
    resolution_damping=0.5,   # d: 0=off, 1=full suppression at res=1
)

# 2. Deposit — agent signals completion at a node
medium.deposit(
    node_id="utils/crypto.py",
    agent_id=self.agent_id,
    intensity=1.0,
    trace_type=TraceType.RESOLUTION,
)
# Internally this routes to: medium.resolution[node_id] += intensity
# (see medium.py:189-192; RESOLUTION bypasses pheromone accumulator)

# 3. Sense — all agents automatically see damped signal
neighborhood = medium.sense("utils/crypto.py", radius=1)
# Internally (medium.py:213-216):
#   raw     = medium.pheromone.get(node, 0.0)
#   res     = medium.resolution.get(node, 0.0)
#   damping = max(0.0, 1.0 - medium.resolution_damping * res)
#   neighborhood[node] = raw * damping

# 4. Gradient — derived from effective pheromone, so already resolution-aware
grad = medium.gradient(current_node)
next_node = max(grad, key=grad.get)

# 5. Calibration guidelines
# resolution_damping=0.3  — gentle nudge; agents still revisit moderately
# resolution_damping=0.5  — balanced default (SOMA benchmark)
# resolution_damping=0.8  — strong repulsion; nearly single-pass coverage
# resolution_damping=1.0  — full suppression; res=1.0 makes node invisible
#
# Deposit intensity encodes confidence in completion:
# intensity=1.0  — fully resolved
# intensity=0.5  — partially resolved, residual gradient preserved
# intensity=0.0  — no-op; use for conditional deposits
```

Key invariant: RESOLUTION traces accumulate but do not decay through the
normal `tick()` diffusion path — they are not included in the sheaf Laplacian
diffusion step, only in the sense() damping computation. Decay (if desired)
must be applied manually or by adding a separate decay sweep in `tick()`.

## Key References

- SOMA `medium.py`, lines 109-116: `Medium.__init__` — `resolution_damping`
  constructor parameter and `self.resolution` dict initialization.
- SOMA `medium.py`, lines 189-192: `deposit()` — branch that routes
  `TraceType.RESOLUTION` into `self.resolution[node_id]` instead of
  `self.pheromone[node_id]`.
- SOMA `medium.py`, lines 196-224: `sense()` — the damping computation:
  `effective = raw * max(0.0, 1 - resolution_damping * res)`.
- Hansen & Ghrist (2021), "Opinion Dynamics on Discourse Sheaves" — the
  sheaf Laplacian convergence proof that underpins the Medium's diffusion
  physics; resolution damping is the biological analogue of dampened opinion
  updating after consensus.

## Bundle navigation

- [Decision flow](diagrams/01_flowchart_decision-points.md) — visual decision points for damping a resolution trace.
- [References index](references/INDEX.md) — load the relevant background mechanism or Port Daddy application.
