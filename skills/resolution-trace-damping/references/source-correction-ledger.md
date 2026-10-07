# Source correction ledger

| Inherited claim | Disposition | Evidence-bound replacement |
|---|---|---|
| SOMA constructor default `d=0.5`, line-level `medium.py` formula, and exact trace semantics | Unverified; removed as source truth | Exact SOMA repository/commit was unavailable in the research pass. Generic formula remains a candidate description only. |
| Resolution never decays | Contradicted for the inspected Port Daddy source | At commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`, resolution multiplies by `decayRate²` and entries below `.01` are deleted (`lib/pheromone.ts:163-170`). |
| Resolution decays at 2× rate / prune at `1e-8` | Contradicted for inspected Port Daddy source; SOMA claim unverified | Port Daddy uses square of decay rate and `.01` cutoff in this source snapshot; do not attribute it to SOMA. |
| `gradient()` consumes effective pheromone | Unresolved | No inspected local consumer establishes this; inherited references disagree. Inspect exact client/action path before making a claim. |
| SOMA “balanced default,” “single-pass,” coverage, 20-trial benchmark, solved-node avoidance | Removed | No source or in-domain result verified. |
| Treg ratios/biological suppression values map to damping parameters | Removed as unsupported analogy | Keep “anti-inflammatory” as a metaphor only; it supplies no parameter or evidence. |
| False completion can never reopen | Corrected | Inspectable Port Daddy source fades resolution; generic implementations still require explicit invalidation/expiry semantics. Test each implementation. |
