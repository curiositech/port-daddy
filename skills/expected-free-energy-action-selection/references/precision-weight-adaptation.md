# Precision Weight Adaptation: The Implicit Exploration Schedule

Precision weights `w_prag` and `w_epist` are the scalars that mix the pragmatic and epistemic terms of EFE. They are not fixed hyperparameters — they are state variables that track whether the agent's generative model is currently well-calibrated. The adaptation rule converts raw prediction error (surprise) into an automatic exploration schedule without any explicit annealing curve.

## The Surprise Signal

After each `update_belief(node_id, found_something)` call, the agent computes per-step surprise:

```python
# found_something=True  → surprise = -log(E[p_n])    (expected to find, found it: low; unexpected: high)
# found_something=False → surprise = -log(1 - E[p_n])
surprise = -np.log(max(expected_or_complement, 1e-10))
```

This is the self-information of the observation under the current Beta posterior. The floor at `1e-10` prevents log(0) when beliefs are near-degenerate. Surprise is appended to a sliding window of length 20 (`_surprise_window`); the oldest entry is evicted when the window is full.

## The Update Rule

`adapt_precision()` fires once per step, after `update_belief()`. It requires at least 5 samples before acting:

```python
neutral_surprise = 0.693   # ln(2): surprise of Beta(1,1) observing either outcome

if mean_surprise > neutral_surprise:   # high surprise: model is frequently wrong
    w_epistemic += precision_adapt_rate          # explore more
    w_pragmatic  = max(0.1, w_pragmatic - precision_adapt_rate * 0.5)
else:                                  # low surprise: model is accurate
    w_pragmatic += precision_adapt_rate          # exploit more
    w_epistemic  = max(0.1, w_epistemic - precision_adapt_rate * 0.5)
```

The asymmetric rate (`+rate` vs `-rate*0.5`) means weights drift up faster than they decay. With `precision_adapt_rate=0.05` (default), a sustained 20-step window of high-surprise observations will raise `w_epist` by ~1.0 and lower `w_prag` by ~0.5. Hard floor at 0.1 prevents either weight from collapsing to zero and locking the agent into pure exploitation or pure exploration.

## What Convergence Looks Like

The neutral threshold `ln(2) ≈ 0.693` is the information-theoretic surprise of an uninformed prior. An agent starting from `Beta(1,1)` on every node will initially generate near-neutral surprise on every visit. As beliefs sharpen — either toward `alpha >> beta` (node is reliably interesting) or `beta >> alpha` (node is reliably boring) — the predicted outcome matches the observation more often and mean surprise drops below 0.693. The rule then increases `w_prag`, which increases the weight on `E[p_n]` in EFE and biases action selection toward known-good nodes. Exploitation emerges from accurate beliefs, not from a time-based schedule.

If a previously converged agent enters a region where the environment has changed (node quality shifts), observations contradict the established posterior, mean surprise rises back above 0.693, and `w_epist` increases automatically. The agent re-enters an exploratory mode without any external signal.

## Why This Is Not Simulated Annealing

Epsilon-greedy with decaying epsilon and Boltzmann cooling both operate on wall-clock time or step count — the schedule is independent of whether the agent is actually learning anything. Precision adaptation is conditioned on the agent's own calibration: it accelerates exploitation only when the model deserves to be trusted. In environments with heterogeneous node quality (some nodes always empty, some always full, some variable), different regions will have different local precision regimes even at the same global step count.

## Interaction with Social Learning

`update_from_pheromone()` updates beliefs from neighbors' pheromone traces before the agent moves. Those soft belief updates also affect the subsequent `update_belief()` call's baseline, which affects surprise, which feeds the precision window. Social learning can therefore accelerate precision convergence in dense-pheromone regions: beliefs sharpen faster, surprise drops faster, and exploitation intensifies sooner — without any explicit coupling between the social signal and the precision weights.

## Tuning Notes

- **`precision_adapt_rate=0.05`** is the SOMA Week 2 validated default. Values above ~0.15 cause oscillation: the window never stabilizes before the weights swing back.
- **`_surprise_window=20`** smooths over the stochasticity of individual step outcomes. Shorter windows (5–10) make precision more reactive but noisier; longer windows (50+) make it sluggish and undermine the re-exploration recovery.
- The `max(0.1, ...)` floors matter: without them, a long run of accurate predictions drives `w_epist` to zero and the epistemic term vanishes from EFE entirely, permanently disabling uncertainty-seeking. This is catastrophic on graphs with newly added nodes.

## Key Points

- The neutral threshold `ln(2) ≈ 0.693` is not arbitrary — it is the surprise of a Beta(1,1) prior, making it the correct zero-point: below means "better than chance", above means "worse than chance".
- Adaptation is asymmetric: weights rise at full `precision_adapt_rate` but fall at half rate, so exploration capacity is lost slowly and regained quickly.
- The sliding window (length 20) buffers single-step noise; precision tracks the 20-step trend, not any individual observation.
- Social pheromone learning indirectly accelerates precision convergence in high-activity graph regions without explicit coupling.
- Hard floors at 0.1 on both weights are a safety invariant: EFE never degenerates to a purely pragmatic or purely epistemic score.

## See Also

- `soma/generative_model.py` — `adapt_precision()` (line ~246), `update_belief()` (line ~100), `_surprise_window` initialization (line ~89). Read alongside the Beta posterior update to see the full data flow.
- SKILL.md §"Precision adaptation" — overview of the mechanism and its role relative to softmax temperature `gamma`.
- `references/efe-decomposition.md` — derivation of the pragmatic/epistemic split and why minimizing G is equivalent to minimizing variational free energy under a prior over outcomes.
