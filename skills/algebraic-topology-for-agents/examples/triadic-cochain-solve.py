"""
Triadic Cochain Hodge Solver Example
Demonstrates exact orthogonal Hodge decomposition on a minimal 3-agent 1-triangle complex.
"""

import numpy as np

def solve_triadic_hodge():
    # 3 nodes (0, 1, 2), 3 edges e0=(0,1), e1=(1,2), e2=(0,2), 1 triangle tau=(0,1,2)
    delta_0 = np.array([
        [-1,  1,  0], # e0: 0 -> 1
        [ 0, -1,  1], # e1: 1 -> 2
        [-1,  0,  1]  # e2: 0 -> 2
    ], dtype=float)

    delta_1 = np.array([
        [1, 1, -1]    # tau: e0 + e1 - e2
    ], dtype=float)

    # Injected lie: Edge 1 reports unexpected discrepancy of +3.0
    g = np.array([0.0, 3.0, 0.0])

    # 1. Gradient component (delta_0 x)
    x, _, _, _ = np.linalg.lstsq(delta_0, g, rcond=None)
    grad = delta_0 @ x
    residual = g - grad

    # 2. Curl component (delta_1.T psi)
    psi, _, _, _ = np.linalg.lstsq(delta_1.T, residual, rcond=None)
    curl = delta_1.T @ psi

    # 3. Harmonic component
    harmonic = residual - curl

    # 4. Legibility ratio
    norm_h_sq = np.sum(harmonic ** 2)
    norm_curl_sq = np.sum(curl ** 2)
    L = norm_h_sq / (norm_h_sq + norm_curl_sq) if (norm_h_sq + norm_curl_sq) > 1e-12 else 0.0

    print("Observed cochain g :", g)
    print("Gradient component :", np.round(grad, 4))
    print("Curl component     :", np.round(curl, 4))
    print("Harmonic component :", np.round(harmonic, 4))
    print(f"Legibility Ratio L : {L:.4f} (Pure Micro-Contract Breach)")

if __name__ == "__main__":
    solve_triadic_hodge()
