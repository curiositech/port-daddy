# Worked Example: Code Review Triage with Three Agents

Three agents must review a Python project's nine modules for security vulnerabilities. No agent knows which modules are most critical. There is no scheduler. The agents must self-organize so high-risk modules are covered first and no module is double-reviewed.

## Step-by-Step

### 1. Build the medium from the import graph

```python
medium = Medium(decay_rate=0.01, diffusion_rate=0.005,
                resolution_damping=0.5, rng_seed=42)

# Topology from repo_parser.py — auth imports crypto, which is a hub
medium.add_node("auth/login.py")
medium.add_node("utils/crypto.py")
medium.add_node("api/payments.py")
medium.add_edge("auth/login.py", "utils/crypto.py")
medium.add_edge("api/payments.py", "utils/crypto.py")

# Seed urgency: payments deadline is 5 ticks out
medium.deposit("api/payments.py", "system", intensity=2.0,
               trace_type=TraceType.PHEROMONE, deadline=medium.time + 5)
```

### 2. Agent-0 arrives first, senses, moves

```python
# Agent-0 starts at auth/login.py
signals = medium.sense("auth/login.py", radius=1)
# → {"auth/login.py": 0.0, "utils/crypto.py": 0.0}  (no gradient yet)

# Stochastic exploration picks api/payments.py (urgency seed visible from radius=2)
# Agent-0 does work, deposits PHEROMONE
medium.deposit("api/payments.py", "agent-0", intensity=1.0,
               trace_type=TraceType.PHEROMONE)
medium.tick(dt=1.0)
# diffusion spreads ~0.005 intensity to utils/crypto.py
```

### 3. Agent-1 arrives, follows gradient away from Agent-0

```python
grad = medium.gradient("utils/crypto.py")
# → {"api/payments.py": +0.87, "auth/login.py": +0.03}
# Agent-1 would climb toward api/payments.py — but first checks antibody
if medium.check_antibody(hash("api/payments.py:sql-injection")):
    skip()   # already solved — negative selection fires
else:
    # Agent-1 visits utils/crypto.py instead (second-highest gradient)
    medium.deposit("utils/crypto.py", "agent-1", 1.0, TraceType.PHEROMONE)
```

### 4. Agent-0 finishes payments, deposits RESOLUTION

```python
medium.deposit("api/payments.py", "agent-0", intensity=2.0,
               trace_type=TraceType.RESOLUTION)

# Effective pheromone at payments is now:
# 0.87 * max(0, 1 - 0.5 * resolution_level) ≈ 0.87 * (1 - 0.5*2.0) = 0.0
# → node disappears from gradient field; Agent-2 routes elsewhere
```

### Expected Output After 10 Ticks

```
medium.hotspots(n=3)
# [("utils/crypto.py", 0.94), ("auth/login.py", 0.21), ("api/payments.py", 0.0)]

diagnostics = medium.tick(dt=1.0)
# {"time": 10, "total_pheromone": 1.15, "distress_nodes": [], "max_pheromone": 0.94}
```

All three modules visited. No double-work. No central scheduler.

## Failure Modes

**1. Numerical blowup on high-degree hubs.**
If `utils/crypto.py` imports 50 modules (degree=50) and you call `medium.tick(dt=1.0)` with `diffusion_rate=0.1`, the stability criterion `dt_eff = 0.9 / (0.1 * 50) = 0.18` kicks in automatically. The clamp is inside `tick()` — do not try to hand-tune `dt` to compensate. If you see pheromone values exceeding `1e6`, you bypassed the medium's tick and applied diffusion manually.

**2. Resolution traces decay too fast, pile-on returns.**
RESOLUTION decays at `2 * decay_rate` (twice as fast as PHEROMONE). On a slow 50-tick simulation with `decay_rate=0.001`, the suppression at `api/payments.py` can fade before Agent-2 arrives, causing redundant work. Fix: deposit RESOLUTION with higher intensity (2.0–4.0) or add an ANTIBODY trace so negative selection fires as a backup:

```python
medium.deposit("api/payments.py", "agent-0", 3.0, TraceType.RESOLUTION)
medium.deposit("api/payments.py", "agent-0", 1.0, TraceType.ANTIBODY,
               pattern_signature=hash("payments-reviewed"))
```
