# Typed Trace Goods: The Five TraceType Channels in SOMA's Medium

`TraceType` (medium.py:42-47) is an enum with five values. Each maps to a distinct "good" in the wide market framework (arXiv:2503.05828), with its own semantics for what it represents, how it affects the Medium's aggregate scalars, and which API calls produce or consume it.

## The Five Types

**PHEROMONE** — The default trace type. Represents work-in-progress, discovery signals, or distress. When deposited, it increments `Medium.pheromone[node_id]` directly. This scalar is what `sense()` and `gradient()` operate on. Decays exponentially at rate `decay_rate` per tick; spreads via Laplacian diffusion. All five types land in `Medium.traces[node_id]` (the raw list), but only PHEROMONE and non-RESOLUTION types route into the `pheromone` dict. This is the dominant signal channel — the one agents climb.

**BELIEF** — Probabilistic claims, intended as the currency for Week 3 belief markets. A BELIEF trace carries two extra fields: `confidence_stake` (how much the depositor wagered) and `proposition` (the claim string). Depositing increments `pheromone[node_id]` like any non-resolution type. To *trade* beliefs, use `sense_typed(node, TraceType.BELIEF, radius)` — it returns `{node_id: [Trace, ...]}` filtered to BELIEF traces only, preserving the full Trace objects with their stake and proposition fields. The tâtonnement price-discovery mechanism (arXiv:2503.05828) is scaffolded but not yet built; for now, agents can read and deposit BELIEF traces but there is no settlement logic.

**PREFERENCE** — Active Inference priors: desired future states the agent wants the world to move toward. Used by `ActiveInferenceAgent` to broadcast its preferred node states into the Medium so other agents can sense convergence or divergence with their own preferences. Like BELIEF, PREFERENCE traces go into `pheromone[node_id]`. The `GenerativeModel` reads PREFERENCE traces via `sense_typed(node, TraceType.PREFERENCE)` during social learning — it sees how many agents prefer a node and updates Beta distribution beliefs accordingly. This is the key mechanism by which EFE-driven agents coordinate without direct messaging.

**ANTIBODY** — Pattern signatures of known-solved or known-bad problems. Carries `pattern_signature` (a hash or embedding string). The negative selection API is `Medium.check_antibody(signature, radius_nodes)` — returns `True` if any ANTIBODY trace in the specified nodes matches the signature. Agents call this before doing work: if the antibody fires, skip the node. ANTIBODY traces do *not* decay faster than PHEROMONE — they use the standard `decay_rate`. Consequence: long-running simulations must either re-deposit antibodies periodically or accept that old pattern memories fade. Unlike RESOLUTION, depositing an ANTIBODY increments `pheromone[node_id]`, so antibody-heavy nodes look attractive to naive gradient-climbers — agents must check antibodies before moving, not just before working.

**RESOLUTION** — Anti-inflammatory signals. Routes into `Medium.resolution[node_id]` (a separate scalar dict) rather than `pheromone`. The effective pheromone that `sense()` returns is `raw_pheromone * max(0, 1 - resolution_damping * resolution_level)`. With default `resolution_damping=0.5`, a resolution level of 2.0 halves the apparent pheromone; at 2.0 the effective signal is zero. Resolution decays at `2 * decay_rate` — twice as fast as pheromone — so anti-inflammatory effects wear off faster than the underlying signal. Agents deposit RESOLUTION after completing work on a node to suppress pile-on. `Medium.snapshot()` surfaces `total_resolution` separately.

## Deposit/Sense/Gradient API

```python
# Write
medium.deposit(node_id, agent_id, intensity,
               trace_type=TraceType.PHEROMONE,   # default
               deadline=None,                     # Optional[float], simulation time
               confidence_stake=0.0,              # BELIEF only
               proposition=None,                  # BELIEF only
               pattern_signature=None,            # ANTIBODY only
               **metadata)                        # arbitrary KV stored in Trace.metadata

# Read — aggregate (PHEROMONE + BELIEF + PREFERENCE + ANTIBODY, resolution-damped)
medium.sense(node_id, radius=1)          # -> {node_id: effective_float}

# Read — typed (returns full Trace objects)
medium.sense_typed(node_id, trace_type, radius=1)  # -> {node_id: [Trace, ...]}

# Navigate — discrete exterior derivative of pheromone 0-cochain
medium.gradient(node_id)                 # -> {neighbor: (p_neighbor - p_self)}

# Negative selection
medium.check_antibody(signature, radius_nodes=None)  # -> bool
```

`gradient()` reads raw `pheromone` values directly — it does not apply resolution damping. Agents that want resolution-aware gradients must call `sense()` and compute deltas manually.

## Key Points

- RESOLUTION is the only type that routes to `Medium.resolution` instead of `Medium.pheromone`; every other type increments the pheromone scalar, making `sense()` and `gradient()` aggregate across PHEROMONE, BELIEF, PREFERENCE, and ANTIBODY indiscriminately.
- `gradient()` is resolution-blind; `sense()` is resolution-aware. An agent navigating by gradient will ignore anti-inflammatory suppression; an agent navigating by sense deltas will respect it.
- ANTIBODY traces increment `pheromone[node_id]`, so a solved node can appear artificially attractive — always check `check_antibody()` before doing work, not just before moving.
- BELIEF and PREFERENCE are semantically distinct but mechanically identical in Week 2; the distinction is critical only in Week 3 belief markets, where `confidence_stake` and `proposition` enter settlement logic.
- Resolution decays at `2 * decay_rate` (medium.py:335), pheromone at `decay_rate` (medium.py:330) — the anti-inflammatory signal is intentionally transient relative to the work signal it suppresses.

## See Also

- `soma/active_inference_agent.py` — how PREFERENCE traces are deposited and read during EFE computation and social learning
- `soma/medium.py:311-394` — `tick()` physics: decay, Laplacian diffusion, urgency amplification, and why resolution gets a separate pass
- arXiv:2503.05828 (wide market framework) — theoretical grounding for why distinct trace types are treated as distinct goods with separate price-discovery mechanisms
