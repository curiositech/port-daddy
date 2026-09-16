#!/usr/bin/env python3
"""Emit the CSVs behind the three figures this pass adds or redraws.

Every series here is the chapter's OWN closed form evaluated at the chapter's
OWN parameters; nothing is fitted and nothing is sketched.

  audit-tower   Ch.5 §5.11, "Numbers by hand": G_0 = 400, B = 50, rho*d = 0.2,
                beta = rho*d*B = 10. While G_k > C*B bribery pays and value
                bleeds LINEARLY by C*beta per level; below that it decays
                GEOMETRICALLY by lambda = 1 - rho*d = 0.8. Depths the chapter
                reports: C=8 -> 27 levels, C=2 -> 36, C=1 -> 53.

  graduated     Ch.7 §7.7.4. A k-round graduated trigger sustains truthful
                claim signalling iff (d-c) < (c-p) * sum_{i=1..k} delta^i, with
                the chapter's stage game d-c = 1, c-p = 2. delta*(k) is the
                root. The chapter reports delta*(3) ~ 0.342 against the grim
                bound 1/3.

  oracle        Ch.7 §7.7.5.10. Cartel fragility threshold
                p_d*(delta) = (pi_C - (1-delta) pi_D) / (L + delta pi_D)
                at the chapter's supplied payoffs pi_C = 5/3, pi_D = 4.95,
                L = 25. The chapter reports p_d*(0.95) ~ 0.0478 and, in the
                Ch.7 solutions, p_d*(0.99) ~ 0.05398 in the epsilon -> 0 limit.

Seed: none -- all three series are deterministic closed forms.
"""
import csv
import math
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- audit tower
G0, B, RHOD = 400.0, 50.0, 0.2
LAM = 1 - RHOD
BETA = RHOD * B  # 10


def tower(C, kmax=60):
    g = G0
    rows = [(0, g, "linear" if g > C * B else "geometric")]
    for k in range(1, kmax + 1):
        if g > C * B:
            g = g - C * BETA
            phase = "linear"
        else:
            g = g * LAM
            phase = "geometric"
        rows.append((k, g, phase))
    return rows


def depth(C):
    """Levels until surviving corrupt value is below one unit."""
    g, k = G0, 0
    while g > 1.0 and k < 500:
        g = g - C * BETA if g > C * B else g * LAM
        k += 1
    return k


with open(f"{OUT}/audit-tower-depth.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["cliques_C", "level_k", "corrupt_value_G_k", "phase"])
    for C in (1, 2, 8):
        for k, g, ph in tower(C):
            w.writerow([C, k, f"{g:.6f}", ph])

# ------------------------------------------------------- graduated trigger
def delta_star(k):
    """Smallest delta with 2*sum_{i=1..k} delta^i > 1  (d-c = 1, c-p = 2)."""
    def f(d):
        return 2 * sum(d ** i for i in range(1, k + 1)) - 1
    lo, hi = 1e-9, 0.999999
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


with open(f"{OUT}/graduated-trigger-threshold.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["punishment_rounds_k", "delta_star", "excess_over_grim"])
    for k in range(1, 13):
        d = delta_star(k)
        w.writerow([k, f"{d:.6f}", f"{d - 1/3:.6f}"])
    w.writerow(["inf", f"{1/3:.6f}", "0.000000"])

# ------------------------------------------------------------ oracle audit
PI_C, PI_D, L = 5 / 3, 4.95, 25.0


def pd_star(delta):
    return (PI_C - (1 - delta) * PI_D) / (L + delta * PI_D)


with open(f"{OUT}/oracle-audit-threshold.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["discount_delta", "pd_star_required_detection"])
    d = 0.80
    while d <= 1.0000001:
        w.writerow([f"{d:.4f}", f"{pd_star(d):.6f}"])
        d += 0.005

print("audit tower depths (levels to G<1):",
      {C: depth(C) for C in (1, 2, 8)})
print("closed-form check, C=8 geometric:",
      math.ceil(math.log(400) / math.log(1.25)),
      "| C=1: 35 linear +", math.ceil(math.log(50) / math.log(1.25)),
      "| C=2: 15 linear +", math.ceil(math.log(100) / math.log(1.25)))
print("delta*:", {k: round(delta_star(k), 4) for k in (1, 2, 3, 4, 6, 8)},
      "grim =", round(1 / 3, 4))
print("pd*: 0.95 ->", round(pd_star(0.95), 5),
      "| 0.99 ->", round(pd_star(0.99), 5),
      "| 0.80 ->", round(pd_star(0.80), 5),
      "| 0.999 ->", round(pd_star(0.999), 5))
print("sigma=0.10 margin at delta=0.95:", round(0.10 / pd_star(0.95), 2), "x")
print("delta where pd* crosses 0.05:",
      [round(d, 3) for d in [x / 1000 for x in range(800, 1001)] if abs(pd_star(d) - 0.05) < 0.0005])
