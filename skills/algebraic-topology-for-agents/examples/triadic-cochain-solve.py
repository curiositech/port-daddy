"""Finite scalar cochain fixtures for a declared oriented 3-cycle.

Model: real scalar vertex/edge cochains, Euclidean inner products, edges
(01, 12, 02), and independently supplied finite edge data.  The output is a
floating-point calculation checked against a tolerance; it is not attribution
or authorization evidence.
"""

from __future__ import annotations

import math
from typing import Iterable

TOLERANCE = 1e-10


def _finite_vector(values: Iterable[float], expected: int) -> list[float]:
    values = list(values)
    if len(values) != expected:
        raise ValueError(f"expected {expected} coordinates, got {len(values)}")
    if any(type(x) not in (int, float) or not math.isfinite(x) for x in values):
        raise ValueError("coordinates must be finite real numbers")
    return [float(x) for x in values]


def dot(a: Iterable[float], b: Iterable[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def norm_sq(a: Iterable[float]) -> float:
    return dot(a, a)


def delta0(x: Iterable[float]) -> list[float]:
    x0, x1, x2 = _finite_vector(x, 3)
    return [x1 - x0, x2 - x1, x2 - x0]


def delta1(g: Iterable[float]) -> float:
    g01, g12, g02 = _finite_vector(g, 3)
    return g01 + g12 - g02


def require_parameters(filled: bool, tolerance: float) -> None:
    if type(filled) is not bool:
        raise ValueError("filled must explicitly be true or false")
    if type(tolerance) not in (int, float) or not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError("tolerance must be positive and finite")


def energy_fraction(harmonic: Iterable[float], curl: Iterable[float], tolerance: float = TOLERANCE) -> float | None:
    require_parameters(False, tolerance)
    harmonic = _finite_vector(harmonic, 3)
    curl = _finite_vector(curl, 3)
    h_energy = norm_sq(harmonic)
    denominator = h_energy + norm_sq(curl)
    if not math.isfinite(denominator):
        raise ValueError("energy calculation overflowed; rescale data and declare new units")
    return None if math.sqrt(denominator) <= tolerance else h_energy / denominator


def result_record(g, gradient, harmonic, curl, filled, tolerance, model):
    # Check computed values too: finite inputs can overflow in intermediate work.
    vectors = [_finite_vector(v, 3) for v in (g, gradient, harmonic, curl)]
    g, gradient, harmonic, curl = vectors
    reconstructed = _finite_vector([a + b + c for a, b, c in zip(gradient, harmonic, curl)], 3)
    error = max(abs(a - b) for a, b in zip(g, reconstructed))
    scale = max(1.0, max(abs(v) for v in g))
    if not math.isfinite(error) or error / scale > tolerance:
        raise ArithmeticError("relative reconstruction error exceeded tolerance")
    orthogonality = {}
    for name, a, b in [("grad_h", gradient, harmonic), ("grad_curl", gradient, curl), ("harmonic_curl", harmonic, curl)]:
        product = dot(a, b)
        norm_product = math.sqrt(norm_sq(a)) * math.sqrt(norm_sq(b))
        if not math.isfinite(product) or not math.isfinite(norm_product):
            raise ValueError("orthogonality calculation overflowed; rescale data")
        if abs(product) / max(1.0, norm_product) > tolerance:
            raise ArithmeticError("normalized orthogonality check exceeded tolerance")
        orthogonality[name] = product
    return {
        "model": model, "filled": filled, "g": g,
        "gradient": gradient, "harmonic": harmonic, "curl": curl,
        "reconstruction_error": error, "relative_reconstruction_error": error / scale,
        "orthogonality": orthogonality,
        "harmonic_residual_energy_fraction": energy_fraction(harmonic, curl, tolerance),
    }


def solve_closed_form(g: Iterable[float], filled: bool, tolerance: float = TOLERANCE) -> dict[str, object]:
    """Return a checked Euclidean split for this triangle or unfilled 3-cycle."""
    require_parameters(filled, tolerance)
    g = _finite_vector(g, 3)
    coefficient = delta1(g) / 3.0
    circle = _finite_vector([coefficient, coefficient, -coefficient], 3)
    gradient = [value - part for value, part in zip(g, circle)]
    harmonic = [0.0, 0.0, 0.0] if filled else circle
    curl = circle if filled else [0.0, 0.0, 0.0]
    return result_record(g, gradient, harmonic, curl, filled, tolerance,
                         "finite scalar cochains; Euclidean inner products; edges (01,12,02)")


def solve_numpy(g: Iterable[float], filled: bool, tolerance: float = TOLERANCE) -> dict[str, object]:
    """NumPy least-squares form of the same explicitly Euclidean calculation."""
    import numpy as np

    require_parameters(filled, tolerance)
    g = np.array(_finite_vector(g, 3), dtype=float)
    d0 = np.array([[-1.0, 1.0, 0.0], [0.0, -1.0, 1.0], [-1.0, 0.0, 1.0]])
    d1 = np.array([[1.0, 1.0, -1.0]]) if filled else np.zeros((0, 3))
    if not np.allclose(d1 @ d0, 0.0, atol=tolerance, rtol=0.0):
        raise AssertionError("declared coboundaries do not form a complex")
    x, *_ = np.linalg.lstsq(d0, g, rcond=None)
    gradient = d0 @ x
    residual = g - gradient
    if filled:
        psi, *_ = np.linalg.lstsq(d1.T, residual, rcond=None)
        curl = d1.T @ psi
        harmonic = residual - curl
    else:
        curl = np.zeros(3)
        harmonic = residual
    return result_record(g.tolist(), gradient.tolist(), harmonic.tolist(), curl.tolist(),
                         filled, tolerance,
                         "finite scalar cochains; Euclidean inner products; NumPy least squares")


def print_result(result: dict[str, object]) -> None:
    print("Model:", result["model"])
    print("Filled face:", result["filled"])
    for key in ("g", "gradient", "harmonic", "curl"):
        print(f"{key:12}:", [round(x, 8) for x in result[key]])
    print("reconstruction error:", f"{result['reconstruction_error']:.3e}")
    print("harmonic residual-energy fraction:", result["harmonic_residual_energy_fraction"])
    print("numeric tolerance:", TOLERANCE)


if __name__ == "__main__":
    g = (0.0, 3.0, 0.0)
    try:
        print_result(solve_numpy(g, filled=True))
    except ImportError:
        print_result(solve_closed_form(g, filled=True))
