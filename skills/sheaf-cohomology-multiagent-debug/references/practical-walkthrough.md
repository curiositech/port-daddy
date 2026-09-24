# Finite triangle and path walkthrough

## Model and observations

Use scalar vertex/edge cochains with oriented triangle edges `(01,12,02)`:

$$D=\begin{bmatrix}-1&1&0\\0&-1&1\\-1&0&1\end{bmatrix}.$$

For independently supplied `g=(1,1,1)`, solve `min_x ||g-Dx||`. The signed cycle sum is `1+1-1=1`, hence no vertex potential exactly explains the edge values. Least squares returns a nonzero residual. This says only that the supplied values are incompatible with this scalar orientation model.

```python
import numpy as np
D=np.array([[-1.,1.,0.],[0.,-1.,1.],[-1.,0.,1.]])
g=np.array([1.,1.,1.])  # supplied independently; do not set g=D@x
x,*_=np.linalg.lstsq(D,g,rcond=None)
rho=g-D@x
assert np.linalg.norm(D.T@rho) < 1e-10
assert np.isclose(g[0]+g[1]-g[2],1.)
```

## Contrast with a path

For path edges `(01,12)`, use the first two rows of `D`. For any `g=(a,b)`, take `x0=0`, `x1=a`, `x2=a+b`; then `D_path x=g`. Thus the residual is zero in this constant scalar path model. It is not a claim that a path has no errors or that an application’s observations are safe.

## Missing and stale data fixture

If an edge coordinate is unavailable, do not substitute zero silently. Exclude it with an explicit visibility mask or return an incomplete-data result. If timestamps/units differ, define a preprocessing or rejection rule before forming `g`; otherwise a residual may measure only that mismatch.

## What to report

Report `D`, orientations, observation provenance, norm, tolerance, `x_hat`, residual, and data omitted by the visibility rule. Inspecting large residual coordinates may guide a human review, but requires no claim about who caused the mismatch and does not authorize a correction.
