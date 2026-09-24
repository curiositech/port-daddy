# Epistemic Scan: Probability-Decaying Coverage Guarantee

The epistemic scan is a lightweight mechanism tacked onto EFE-based action selection that closes the coverage gap left by gradient-following alone. The core problem: an agent that always climbs EFE gradients will never visit nodes that are topologically disconnected from high-pheromone regions. Isolated nodes accumulate zero visits indefinitely. Epistemic teleportation (lines 189-201) addresses locally weak EFE, but it requires at least one connected neighbor to lose interest in — it cannot reach nodes the agent has no path toward.

The scan fires unconditionally after `total_steps > 3`, independent of EFE scores and teleport threshold comparisons. This makes it an *innate* drive, not a fallback triggered by local conditions.

## Mechanism Detail

```python
# soma/active_inference_agent.py:203-214
if self.total_steps > 3:
    all_nodes = list(medium.graph.nodes())
    unseen = [n for n in all_nodes
              if self.model.visit_counts.get(n, 0) == 0 and n != self.position]
    if unseen:
        scan_prob = len(unseen) / max(len(all_nodes), 1)
        if self.rng.random() < scan_prob:
            target = max(unseen, key=lambda n: self.model.get_belief(n).uncertainty)
            return target, "epistemic_scan"
```

`scan_prob = |unseen_nodes| / |all_nodes|` is the key formula. It has a self-extinguishing property: as the agent accumulates visits, the numerator shrinks while the denominator stays fixed, so the probability of firing decays toward zero automatically. At session start (all nodes unseen), `scan_prob = 1.0` and the scan fires every step after step 3. At 50% coverage, `scan_prob = 0.5`. Near saturation (1 of 10 nodes unseen), `scan_prob = 0.1` — the scan is rare, not absent.

The step 3 guard (`total_steps > 3`) prevents premature jumping before the agent has built any local belief. Without it, fresh agents would teleport on step 1 before EFE has any information to act on.

When the scan fires, it does not pick a random unseen node. It picks `argmax_uncertainty` over unseen nodes — the one with the highest `Beta(α, β)` variance. This means the scan is information-theoretically optimal: among nodes the agent has never visited, it selects the one where uncertainty reduction would be largest.

The returned action type `"epistemic_scan"` is distinct from `"epistemic_teleport"` (lines 218-224), which handles the case where local neighbors are collectively uninteresting but the agent is still reachable via gradient following from somewhere. The two mechanisms are complementary: teleport handles connected-but-boring regions; scan handles structurally isolated nodes.

The practical effect in the SOMA Week 2 benchmark: `utils/crypto.py`, a node with no inbound imports and therefore zero pheromone gradient, gets visited at step 3 in 100% of trials vs ~30% in Week 1. The scan is the only mechanism that could guarantee this — no amount of EFE tuning reaches a node that is invisible to gradient flow.

The mechanism is implemented inside `_select_action()` and runs after EFE softmax selection and before the teleport fallback is evaluated. Control flow returns immediately on a scan hit (`return target, "epistemic_scan"`), bypassing the EFE-selected action entirely for that step.

## Key Points

- `scan_prob = |unseen| / |total|` decays to zero as coverage saturates — no config knob needed, no hyperparameter to tune
- The step 3 guard is intentional: early steps build local belief; premature scanning before any gradient is formed wastes the first observations on random teleports
- Among unseen nodes, `argmax_uncertainty` (Beta variance) is used as the selection criterion — not random, not nearest, not highest pheromone
- The scan fires *before* checking teleport threshold, and returns immediately if triggered, so a scan step never also evaluates EFE for the same decision
- Action type `"epistemic_scan"` in trace logs identifies steps caused by this mechanism, distinct from `"epistemic_teleport"` and `"efe_pragmatic"` / `"efe_epistemic"`

## See Also

- `epistemic-teleport.md` — the complementary mechanism for connected-but-low-EFE situations (lines 189-201)
- `generative-model-beliefs.md` — Beta distribution belief representation and `visit_counts` tracking that the scan reads from
- `efe-action-selection.md` — full EFE softmax pipeline that the scan runs after and can short-circuit
