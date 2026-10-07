"""Finite scalar examples; numerical cohomology rank requires NumPy.

No runtime, attribution, or effect behavior. Tolerances are explicit numerical
model choices, not certificates about real observations or exact arithmetic.
"""
from __future__ import annotations
import math

D = ((-1.,1.,0.),(0.,-1.,1.),(-1.,0.,1.))

def vector(values, length):
    values = list(values)
    if len(values) != length or any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        raise ValueError("finite coordinates with matching dimension required")
    return [float(v) for v in values]

def matvec(matrix, x):
    rows = list(matrix)
    if not rows: raise ValueError("this helper requires at least one matrix row")
    x = vector(x, len(rows[0]))
    rows = [vector(row, len(x)) for row in rows]
    return vector([sum(a*b for a,b in zip(row,x)) for row in rows], len(rows))

def transpose_matvec(matrix, y):
    rows = list(matrix)
    if not rows: raise ValueError("this helper requires at least one matrix row")
    rows = [vector(row, len(rows[0])) for row in rows]
    y = vector(y, len(rows))
    return vector([sum(row[i]*v for row,v in zip(rows,y)) for i in range(len(rows[0]))], len(rows[0]))

def residual_triangle(g):
    g = vector(g, 3)
    c = (g[0]+g[1]-g[2])/3.0
    rho = vector([c,c,-c], 3)
    grad = vector([a-b for a,b in zip(g,rho)], 3)
    norm = math.hypot(*rho)
    if not math.isfinite(norm): raise ValueError("computed norm overflowed; rescale the model")
    return {"gradient":grad,"residual":rho,"norm":norm}

def numerical_h1_dimension(delta0, delta1, tolerance=1e-10):
    """Numerical rank formula for finite Euclidean matrices at an absolute tolerance."""
    import numpy as np
    if type(tolerance) not in (float,int) or not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError("positive finite absolute tolerance required")
    a,b = np.asarray(delta0,dtype=float),np.asarray(delta1,dtype=float)
    if a.ndim != 2 or b.ndim != 2 or b.shape[1] != a.shape[0]:
        raise ValueError("coboundary dimensions do not compose")
    if not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("finite coboundaries required")
    product = b @ a
    if not np.isfinite(product).all() or np.any(np.abs(product) > tolerance):
        raise ValueError("chain condition fails at the declared tolerance")
    rank_a = int(np.linalg.matrix_rank(a,tol=tolerance)) if a.size else 0
    rank_b = int(np.linalg.matrix_rank(b,tol=tolerance)) if b.size else 0
    dimension = a.shape[0]-rank_a-rank_b
    if dimension < 0: raise ValueError("numerical ranks inconsistent; revise tolerance/model")
    return {"dimension":dimension,"rank_delta0":rank_a,"rank_delta1":rank_b,"absolute_tolerance":tolerance}
