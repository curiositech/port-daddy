#!/usr/bin/env python3
"""Numeric source for figures/legible-swarm-specialization.tex (fig:specialization).

Recomputes every coordinate plotted in the specialization regime diagram of
whitepaper/source/legible-swarm.tex, Thm. thm:specialization.

Two thresholds on the skill premium r = mu_spec / mu_pool, both as functions of
the pooled utilization rho = lambda_F / (c mu_pool):

  g(rho, c)      Erlang-C boundary (Paper 6, Thm. 2, A = 0 case) -- correct
                 g = c*rho + c(1-rho) / (c(1-rho) + C(c, rho))
  gtilde(rho, c) the threshold originally proposed in this whitepaper -- falsified
                 gtilde = 1 + (c-1) rho / (1 - rho)

C(c, rho) is the Erlang-C delay probability. FCFS, exponential service, mean
response-time objective throughout.

Deterministic closed-form evaluation: no sampling, no seed. The falsification
itself (the simulated z-scores quoted in the caption) is not recomputed here --
it belongs to whitepaper/research b8_specialization.py, seed 20260816.

Run:  python3 legible-swarm-specialization.py
"""

from math import factorial

XS, YS = 10.0, 2.0  # cm per unit rho; cm per unit (r - 1)
RMAX = 4.0          # top of the plotted premium axis
C = 3               # pool size drawn in the figure


def erlang_c(c, rho):
    """Erlang-C delay probability for an M/M/c queue at utilization rho."""
    a = c * rho
    head = sum(a ** n / factorial(n) for n in range(c))
    tail = a ** c / (factorial(c) * (1 - rho))
    return tail / (head + tail)


def g(rho, c):
    """Correct specialization boundary (Erlang-C), accountability value A = 0."""
    return c * rho + c * (1 - rho) / (c * (1 - rho) + erlang_c(c, rho))


def gtilde(rho, c):
    """The whitepaper's originally proposed threshold. Falsified in both directions."""
    return 1 + (c - 1) * rho / (1 - rho)


def w_pool(c, rho, mu_g):
    """Mean response time of the M/M/c pool."""
    return (1 + erlang_c(c, rho) / (c * (1 - rho))) / mu_g


def crossing(c, lo=0.05, hi=0.90):
    """rho where the two thresholds agree (bisection on g - gtilde)."""
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if g(mid, c) - gtilde(mid, c) > 0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def pt(rho, r):
    return "(%.3f,%.3f)" % (rho * XS, (r - 1) * YS)


def curve(f, a, b, n):
    return [pt(a + (b - a) * i / n, f(a + (b - a) * i / n)) for i in range(n + 1)]


def block(points, per=6):
    return "\n     ".join(" ".join(points[i:i + per]) for i in range(0, len(points), per))


if __name__ == "__main__":
    x_cross = crossing(C)
    x_top = 0.6  # gtilde(rho, 3) = 4 exactly at rho = 0.6
    gc = lambda r: g(r, C)
    gt = lambda r: gtilde(r, C)

    print("%% crossing rho = %.5f, g = %.4f" % (x_cross, g(x_cross, C)))
    print("\n%% g(rho,3), rho 0.02..0.97")
    print("     " + block(curve(gc, 0.02, 0.97, 38)))
    print("\n%% gtilde(rho,3), rho 0.02..0.60")
    print("     " + block(curve(gt, 0.02, 0.60, 29)))
    print("\n%% lens I (gtilde certifies a specialist who loses)")
    print("     " + block(curve(gt, 0.02, x_cross, 14)
                          + list(reversed(curve(gc, 0.02, x_cross, 14)))))
    print("\n%% lens II (gtilde rejects a specialist who wins), capped at r = 4")
    print("     " + block(curve(gc, x_cross, 0.97, 30)
                          + [pt(0.97, RMAX), pt(x_top, RMAX)]
                          + list(reversed(curve(gt, x_cross, x_top, 14)))))

    # The worked instance carried in the text.
    lam, mu_s, mu_g = 2.0, 3.0, 1.2
    rho = lam / (C * mu_g)
    print("\n%% worked instance: lambda=2/hr, mu_spec=3/hr, c=3 at mu_pool=1.2/hr")
    print("%%   rho = %.4f   r = %.4f" % (rho, mu_s / mu_g))
    print("%%   g = %.4f   gtilde = %.4f   C(3,rho) = %.4f"
          % (g(rho, C), gtilde(rho, C), erlang_c(C, rho)))
    print("%%   W_solo = %.4f hr   W_pool = %.4f hr" % (1 / (mu_s - lam), w_pool(C, rho, mu_g)))
    print("%%   plotted at %s" % pt(rho, mu_s / mu_g))
    print("%% saturation: g(0.99,3) = %.4f, gtilde(0.99,3) = %.1f" % (g(0.99, C), gtilde(0.99, C)))
