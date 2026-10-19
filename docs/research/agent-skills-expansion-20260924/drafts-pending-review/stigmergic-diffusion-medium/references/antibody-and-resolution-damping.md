# Antibody Negative Selection and Resolution Damping

Two complementary mechanisms prevent agent pile-on in SOMA: `check_antibody()` suppresses work on already-known patterns before any effort is expended; RESOLUTION trace damping suppresses attraction to nodes that have already been worked to completion. They operate at different points in the pipeline — one is a precondition gate, the other is a continuous perceptual filter.

## `check_antibody()` — Negative Selection (medium.py:277)

```python
def check_antibody(self, pattern_signature: str, radius_nodes: Optional[Set[str]] = None) -> bool:
    nodes_to_check = radius_nodes or set(self.traces.keys())
    for node_id in nodes_to_check:
        for trace in self.traces.get(node_id, []):
            if (trace.trace_type == TraceType.ANTIBODY
                    and trace.pattern_signature == pattern_signature):
                return True
    return False
```

An ANTIBODY trace (`TraceType.ANTIBODY`) carries a `pattern_signature` field — a hash or embedding fingerprint of a known-bad or known-solved pattern. When an agent is about to begin work, it first calls `check_antibody(signature)`. If the Medium already contains a matching ANTIBODY trace anywhere (or within a specified `radius_nodes` set), the call returns `True` and the agent skips. This is immune-system negative selection: clones that react to self-antigens are culled before they act.

**Pattern signature generation** is left to the caller. In `real_review.py`, the signature is a SHA-256 prefix of the file content. For more semantic matching, an embedding vector hash works. The contract is: same content → same signature → skip.

**Scope narrowing:** pass `radius_nodes` to limit the antibody scan to a local neighborhood rather than the full Medium. This is important in large graphs where a full scan is O(|V| × max_traces). Typically callers pass the node's 1-hop neighborhood from `set(self.graph.neighbors(node_id)) | {node_id}`.

**No decay on ANTIBODY traces.** The `tick()` diffusion/decay loop only operates on `self.pheromone` and `self.resolution` scalars. The raw `Trace` objects in `self.traces` are never pruned by the medium itself — antibody memory is permanent unless a higher-level process removes traces explicitly.

## RESOLUTION Trace Damping (medium.py:189, 277→sense())

When a problem is solved, an agent deposits a RESOLUTION trace:

```python
# medium.py:189
if trace_type == TraceType.RESOLUTION:
    self.resolution[node_id] += intensity
else:
    self.pheromone[node_id] += intensity
```

RESOLUTION traces bypass the pheromone accumulator entirely — they accumulate into a separate `self.resolution` scalar per node. This keeps the two signals orthogonal: pheromone represents "there is work here," resolution represents "that work is done."

The damping is applied multiplicatively inside `sense()` (medium.py:215):

```python
raw = self.pheromone.get(current, 0.0)
res = self.resolution.get(current, 0.0)
damping = max(0.0, 1.0 - self.resolution_damping * res)
neighborhood[current] = raw * damping
```

So **effective pheromone = raw × (1 − d × res)** where `d = self.resolution_damping` (default 0.5). At `res = 1.0`, effective pheromone is halved. At `res = 2.0`, it goes to zero (clamped at 0). The node becomes invisible to gradient-climbing agents regardless of how much raw pheromone it still holds.

**Critically, `gradient()` does not apply damping** (medium.py:258). It reads from `self.pheromone` directly. This means gradient() returns raw, un-damped differences. Only agents using `sense()` for neighborhood scanning experience the anti-inflammatory effect. If you write a new agent that navigates by `gradient()`, you must apply damping manually or accept that completed nodes remain attractive.

**Resolution also diffuses** via `tick()` alongside pheromone — the same Euler step diffuses `self.resolution` across edges with the same `diffusion_rate`. This means a solved node gradually signals its neighbors, preemptively dampening adjacent work. The effect radius grows with diffusion steps; in a sparse graph after 5–10 ticks, the entire connected component of a solved node will show suppressed effective pheromone.

## Interaction Between the Two Mechanisms

The mechanisms fire at different times:

1. **Before work**: `check_antibody(signature)` — O(traces) scan, binary gate, pure skip.
2. **During navigation**: `sense()` damping — continuous, analog suppression of gradient signal.

An antibody match means "I know this exact pattern, skip entirely." A high RESOLUTION level means "this area has been worked; the gradient is now weak." A node can have high raw pheromone but near-zero effective pheromone after resolution. Agents that rely solely on gradient will still be attracted (bug risk); agents using sense() will naturally route away.

Pile-on prevention works best when both are used: RESOLUTION damping redirects agents away during navigation, and ANTIBODY traces prevent redundant work even if an agent somehow reaches a solved node.

## Key Points

- `check_antibody()` scans raw `Trace` objects for `TraceType.ANTIBODY` with matching `pattern_signature`; pass `radius_nodes` to avoid O(|V|) full scans in large graphs.
- ANTIBODY traces never decay — they are permanent medium memory. RESOLUTION traces do decay and diffuse via `tick()`.
- Effective pheromone formula: `raw * max(0, 1 - resolution_damping * resolution_level)`, applied only in `sense()`, not in `gradient()`.
- `resolution_damping=0.5` (default) means `res=2.0` zeroes out effective pheromone; tune higher for faster pile-on prevention, lower for softer suppression.
- `gradient()` bypasses damping — agents using gradient-only navigation are immune to RESOLUTION suppression and will pile on completed nodes.

## See Also

- `sheaf-laplacian-diffusion.md` — how both pheromone and resolution scalars evolve under `tick()`, Euler stability constraint
- `trace-types-and-deposit.md` — full `TraceType` enum, `deposit()` contract, how RESOLUTION bypasses the pheromone accumulator
- `active-inference-efe-action-selection.md` — how EFE agents weight `sense()` output (damped effective pheromone) in the pragmatic term G(n)
