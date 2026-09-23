# Resolution Trace Damping: Mechanics of Anti-Inflammatory Suppression

The damping formula `effective_pheromone = raw · (1 − damping_factor · resolution_level)` is applied at read time, not write time. The raw pheromone value at each node is never modified by resolution; what changes is what agents *perceive* when they call `sense()`. This is the critical design choice: damping is a perceptual filter, not a destructive mutation of the pheromone field. An agent depositing a RESOLUTION trace does not erase prior work signals — it merely makes the node look less attractive to agents deciding where to go next.

## Concrete Arithmetic

In `medium.py:213–216`, the computation is:

```python
raw = self.pheromone.get(current, 0.0)
res = self.resolution.get(current, 0.0)
damping = max(0.0, 1.0 - self.resolution_damping * res)
neighborhood[current] = raw * damping
```

With default `resolution_damping = 0.5` (constructor, line 113), a node with `resolution = 1.0` yields a damping multiplier of `0.5` — half the raw signal visible. At `resolution = 2.0`, multiplier hits `0.0` (clamped by `max(0.0, ...)`), making the node effectively invisible regardless of how much raw pheromone remains. There is no negative effective pheromone; the clamp prevents inversion.

## RESOLUTION Decay Rate: 2× Faster Than Pheromone

In `tick()` at line 335:

```python
resolution_decay = math.exp(-self.decay_rate * 2.0 * dt)
```

Resolution traces decay at twice the rate of regular pheromone (`decay_rate * 2.0` vs `decay_rate * 1.0`). With default `decay_rate = 0.01` and `dt = 1.0`, standard pheromone retains `exp(-0.01) ≈ 0.9900` per tick; resolution retains `exp(-0.02) ≈ 0.9802` per tick. The half-life of resolution is roughly 35 ticks vs 69 ticks for pheromone. This asymmetry is intentional: anti-inflammatory suppression should be transient so that a re-opened problem (regression, re-filed bug) can re-attract agents after the resolution signal fades.

## Threshold for Negligibility Prune

After decay in `tick()`, both pheromone and resolution fields are pruned against `epsilon = 1e-8` (lines 380–386):

```python
if abs(self.pheromone[node_id]) < epsilon:
    self.pheromone[node_id] = 0.0
for node_id in list(self.resolution.keys()):
    if abs(self.resolution[node_id]) < epsilon:
        self.resolution[node_id] = 0.0
```

This is a zero-assignment, not a key deletion — the dict entry remains, avoiding KeyError on subsequent `sense()` calls. Values are not pruned from the dict, only zeroed. The `1e-8` threshold is deliberately below any meaningful gradient: a pheromone value of `1e-8` after a 100-node graph Laplacian diffusion step contributes at most `~1e-10` gradient signal, which is below floating-point noise for any `np.float64` comparison an agent would perform. When resolution zeroes out this way, `damping = max(0.0, 1.0 - 0.5 * 0.0) = 1.0`, so the node becomes fully visible again.

## Separation of Resolution from the Pheromone Field

Resolution intensity is stored in `self.resolution` (a separate dict from `self.pheromone`). When `deposit()` is called with `TraceType.RESOLUTION`, line 190 routes the intensity to `self.resolution[node_id]` instead of `self.pheromone[node_id]`. This means:

- Gradient computation (`gradient()`, lines 270–273) reads raw `self.pheromone` directly — gradient between nodes is based on undamped pheromone. Only neighborhood sensing via `sense()` applies damping.
- An agent following a gradient can still be pulled toward a resolved node if the gradient is strong enough, but once it arrives and calls `sense()` again, the local effective signal is damped, reducing motivation to deposit further work traces there.

## Key Points

- Damping is perceptual, not destructive: `self.pheromone` is never modified by RESOLUTION; only `sense()` output is attenuated.
- Default `resolution_damping = 0.5`; full suppression requires `resolution >= 2.0` (clamp at zero).
- RESOLUTION decays at `2× decay_rate`, giving a half-life ~35 ticks vs ~69 ticks for pheromone at defaults — making suppression transient by design.
- Negligibility prune threshold is `1e-8`; values are zeroed in-place, not deleted, to avoid KeyError in subsequent sense calls.
- `gradient()` uses raw pheromone; only `sense()` applies the damping multiplier, so gradient-following is not fully suppressed at resolved nodes.

## See Also

- `soma/medium.py` `tick()` method — full physics including pheromone decay, diffusion stability clamping, urgency amplification, and the prune step
- `TraceType.ANTIBODY` — complementary mechanism: antibodies suppress re-execution of known patterns via `check_antibody()`, while RESOLUTION suppresses re-visitation by concentration damping
- `Medium.freeze_baseline()` / `deviation_from_baseline()` — tolerance baseline system; agents should react to deviations above baseline, not raw pheromone, to avoid false positives in high-activity steady states
