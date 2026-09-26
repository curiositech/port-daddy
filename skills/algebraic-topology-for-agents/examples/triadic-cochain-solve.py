"""
Triadic Cochain Hodge Solver Example
Demonstrates exact orthogonal Hodge decomposition on a minimal 3-agent 1-triangle complex.
Supports standard Python math fallback when NumPy is not installed.
"""

def solve_triadic_hodge():
    try:
        import numpy as np
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
        norm_h_sq = float(np.sum(harmonic ** 2))
        norm_curl_sq = float(np.sum(curl ** 2))
        L = norm_h_sq / (norm_h_sq + norm_curl_sq) if (norm_h_sq + norm_curl_sq) > 1e-12 else 0.0

        print("[Engine: NumPy]")
        print("Observed cochain g :", g)
        print("Gradient component :", np.round(grad, 4))
        print("Curl component     :", np.round(curl, 4))
        print("Harmonic component :", np.round(harmonic, 4))
        print(f"Legibility Ratio L : {L:.4f} (Pure Micro-Contract Breach)")

    except ImportError:
        # Pure Python standard-library closed form solver
        # For single triangle tau=[v0,v1,v2]: delta_1 = [1, 1, -1]
        g = [0.0, 3.0, 0.0]
        circulation = g[0] + g[1] - g[2] # 3.0
        # Normal equations: delta_1 delta_1^T psi = circulation => 3 psi = 3.0 => psi = 1.0
        psi = circulation / 3.0
        curl = [psi * 1.0, psi * 1.0, -psi * 1.0] # [1.0, 1.0, -1.0]
        grad = [g[0] - curl[0], g[1] - curl[1], g[2] - curl[2]] # [-1.0, 2.0, 1.0]
        harmonic = [0.0, 0.0, 0.0]

        norm_h_sq = sum(h**2 for h in harmonic)
        norm_curl_sq = sum(c**2 for c in curl)
        L = norm_h_sq / (norm_h_sq + norm_curl_sq) if (norm_h_sq + norm_curl_sq) > 1e-12 else 0.0

        print("[Engine: Pure Python Standard Library]")
        print("Observed cochain g :", g)
        print("Gradient component :", [round(v, 4) for v in grad])
        print("Curl component     :", [round(v, 4) for v in curl])
        print("Harmonic component :", [round(v, 4) for v in harmonic])
        print(f"Legibility Ratio L : {L:.4f} (Pure Micro-Contract Breach)")

if __name__ == "__main__":
    solve_triadic_hodge()
