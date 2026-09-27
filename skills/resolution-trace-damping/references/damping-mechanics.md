# Damping mechanics: formula and implementation scope

## Generic formula described by the inherited skill

The inherited generic formula is `effective = raw * max(0, 1 - d * res)`. It preserves the raw signal and clamps the residual multiplier at zero. This is a formula under discussion, not a universal swarm behavior or empirical result. Parameter domain, source version, and the consumer of effective values must be verified.

## Port Daddy source snapshot inspected for this draft

In linked worktree commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`, `lib/pheromone.ts` defines `dampedStrength` using `r = min(1, max(0, damping * resolution))` and `raw * (1-r)` (lines 28–32). `sniffEffective` defaults `damping=1` (line 312), while `createPheromoneManager` defaults `decayRate=0.95` and `intervalMs=60000` (line 85). Each evaporation tick multiplies pheromones by `decayRate` and resolutions by `decayRate²`; both are deleted below `0.01` (lines 152–170). These are source facts for that commit, not proof of deployed runtime behavior.

The inspected file has no `gradient()` consumer proving that gradients use effective pheromone. Therefore this source check resolves neither the generic SOMA gradient claim nor the actual downstream behavior of agents. Inspect the chosen client/action path separately. No SOMA `medium.py` source or benchmark was verified; all inherited SOMA line-level and performance claims are withdrawn pending exact source identity and review.

## Arithmetic sanity check

For the Port Daddy function at the inspected commit, `raw=1`, `damping=0.5`, `resolution=1` gives `r=0.5` and effective value `0.5`. At `damping=1`, `resolution=1`, it gives zero. The multiplier saturates at one for `damping * resolution >= 1`. This is direct arithmetic over the source expression, not a task-allocation or coverage result.

## Domain and observation limits

The stated `[0, raw]` bound assumes finite nonnegative inputs. At the pinned source, a nonfinite/nonpositive resolution returns raw; damping and raw are not fully checked. For example, positive resolution with `damping=NaN` yields `NaN`, while the map helper omits it because it fails the cutoff comparison. This is an input-validation gap, not a meaningful zero priority. The strength writer also lacks an explicit finite-number check; schema/route guards must be inspected independently. Keep malformed-input findings separate from policy outcomes.

The constructed Python example in the entrypoint validates its numeric domain and ignores stale completion evidence. It illustrates a proposed policy; it does not repair or reproduce the repository helper.
