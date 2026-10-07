# Worked Example: Code Review Agent on a 5-Node Import Graph

## Scenario

A code review agent is dropped onto a Python project whose import graph has five nodes: `main`, `auth`, `db`, `utils`, and `crypto`. The agent has never visited any node. It must decide where to move first, then update its beliefs based on what it finds.

## Step-by-Step

**Initial state — all beliefs are Beta(1, 1), maximum ignorance:**

```
Node      alpha  beta  E[p]   Var[p]   visits  novelty
main        1     1    0.500  0.0417     0       1.000
auth        1     1    0.500  0.0417     0       1.000
db          1     1    0.500  0.0417     0       1.000
utils       1     1    0.500  0.0417     0       1.000
crypto      1     1    0.500  0.0417     0       1.000
```

`w_prag = 1.0`, `w_epist = 1.5`, `gamma = 4.0`, `resolution_damping = 0` (nothing resolved yet).

**Step 1 — compute EFE for the agent's neighbors (assume `main` is adjacent to `auth`, `db`, `utils`):**

```python
# All three neighbors are identical at step 0:
damping   = max(0, 1 - 0 * 0) = 1.0
pragmatic = -E[p] * damping   = -0.500 * 1.0  = -0.500
epistemic = -Var[p] * novelty = -0.0417 * 1.0 = -0.0417

G(auth) = 1.0 * (-0.500) + 1.5 * (-0.0417) = -0.5625   # same for db, utils
```

Softmax over `-4.0 * G` is uniform — agent picks `auth` at random (p = 1/3 each).

**Step 2 — agent visits `auth`, finds a bug (outcome = True):**

```python
# Bayesian update: found_something=True → alpha += 1
auth.alpha = 2,  auth.beta = 1
E[p_auth]   = 2/3  = 0.667
Var[p_auth] = 2/(9 * 4) = 0.0556

# Surprise = -log(E[p] before update) = -log(0.5) = 0.693  (neutral)
# Precision weights unchanged this step (mean surprise ≈ ln(2))
```

**Step 3 — re-score neighbors from `auth` (now adjacent to `main`, `db`, `crypto`):**

```python
G(main) = 1.0 * (-0.500) + 1.5 * (-0.0417) = -0.5625  (unvisited, prior)
G(db)   = same = -0.5625
G(crypto) = same = -0.5625  # <-- still unseen; epistemic scan fires here

# Epistemic scan probability: len(unseen)/total = 4/5 = 0.80
# rng draws 0.61 < 0.80 → scan fires
# Highest Var[p] * novelty among all unseen = tied; agent teleports to crypto
```

**Result after 3 steps:**

```
auth:   reviewed, bug found (E[p] = 0.667, belief sharpened)
crypto: reviewed via epistemic scan (would otherwise require adjacency traversal)
main, db, utils: still prior — EFE will pull agent there next
```

No node is permanently hidden. `utils/crypto.py`-class isolation (the gap that caused 50% task failure in Week 1 epsilon-greedy) is closed by the scan.

## Failure Modes

**1. Precision collapse (w_prag → 1.0, w_epist → 0).**
If the agent finds bugs on every early node, surprise stays low and `adapt_precision()` shifts weight fully toward exploitation. Isolated unvisited nodes with low prior `E[p]` then have near-zero EFE pull. Fix: set a floor on `w_epist` (e.g. `max(0.2, w_epist)`) or rely on epistemic teleportation as a safety net — it fires independently of precision weights.

**2. Teleportation thrashing.**
With a low `teleport_threshold` (default 0.01), the agent teleports whenever local EFE differences are small, even when a fine local gradient exists. This wastes steps. Fix: raise `teleport_threshold` to 0.05–0.10 and confirm the teleport target is at least 1.5x more informative than the best neighbor before jumping.
