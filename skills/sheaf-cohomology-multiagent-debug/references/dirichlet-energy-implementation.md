# Dirichlet energy measures a declared state disagreement

For a finite `delta0` and vertex assignment `x`, the Euclidean Dirichlet energy is

$$E(x)=\|\delta_0x\|_2^2.$$

It measures disagreement between endpoint restrictions in the declared model. It is not an observed-edge completion residual unless the question has explicitly defined such a relation. It has units inherited from `x` and the maps; raw values are not comparable across scales without a declared normalization and evaluation objective.

```python
import numpy as np

def energy(delta0, x):
    delta0 = np.asarray(delta0, dtype=float)
    x = np.asarray(x, dtype=float)
    if delta0.ndim != 2 or x.ndim != 1 or x.size != delta0.shape[1]:
        raise ValueError("matrix and vertex-vector dimensions must match")
    if not np.isfinite(delta0).all() or not np.isfinite(x).all():
        raise ValueError("finite matrix and vertex vector required")
    edge = delta0 @ x
    value = float(edge @ edge)
    if not np.isfinite(edge).all() or not np.isfinite(value):
        raise ValueError("computed energy overflowed; rescale and declare units")
    return value, edge
```

For constant scalar identity restrictions, `delta0.T @ delta0` is the ordinary graph Laplacian and the expression reduces to the familiar sum of squared edge differences. That identity does not apply to nonidentity/heterogeneous sheaves without the corresponding maps and metric.

## Monitoring limits

A time series can show whether this particular numeric quantity decreases under a declared update rule. It cannot justify fixed healthy/alert thresholds, prove equilibrium, infer `dim H1`, or classify a residual’s cause. A zero energy state is a global section of the chosen model; it is not a settlement or safety criterion.

A reproducible report records the map version, units, normalization, time window, missing-observation handling, solver tolerance, and the separate domain checks needed before effects.
