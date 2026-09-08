#!/usr/bin/env python3
"""
B6 — The Front-Loaded Probation Theorem: the newcomer ramp is a cliff
=====================================================================
Portfolio §B6 / doc3 B6. Setting: a newcomer's economic ceiling is restricted
by a probation schedule of ceiling gaps g_t >= 0 over a maturation horizon
T (t = 0..T-1). Two discount factors:
  - delta_h: the HONEST newcomer's discount (patient; keeps working),
  - delta_f: the FRAUDSTER/whitewasher's discount, delta_f < delta_h
             (short horizon — the whole reason it whitewashes).

DETERRENCE constraint: a whitewasher re-entering fresh must forgo, in its own
discounting, at least the maximum single-outcome fraud gain G_max:

    sum_t delta_f^t * g_t  >=  G_max                                   (D)

HONEST BURDEN: the same schedule taxes the honest newcomer

    H(g) = sum_t delta_h^t * g_t                                       (H)

CLAIM (the probation cliff). The deterrence-to-honest-cost ratio of a unit gap
at time t is delta_f^t / delta_h^t = (delta_f/delta_h)^t, STRICTLY decreasing
in t. Exchange argument: moving gap mass from any later period to any earlier
one (holding (D) tight) strictly lowers H; iterating drives all mass to t = 0.
So the maximally FRONT-LOADED schedule g* = (G_max, 0, ..., 0) — the deepest
restriction immediately, a cliff, not a ramp — minimizes the honest burden:
H(g*) = G_max, and for any feasible g,
    H(g) = sum_t (delta_h/delta_f)^t * delta_f^t g_t
         >= sum_t delta_f^t g_t   >= G_max = H(g*)      [(delta_h/delta_f)^t >= 1]
with equality only if all mass sits at t = 0. No feasible schedule dominates
the cliff. Mildly counterintuitive vs deferred-compensation instincts (Lazear):
here the punishment IS the ramp re-paid after reset, so it must land where the
short-horizon type still feels it — early.

FALSIFICATION (this script): random search for a dominating schedule across
4,000 random instances (delta_h, delta_f, T, G_max). Per instance we generate
random feasible schedules (constraint (D) binding) plus structured adversaries
(uniform, back-loaded, two-point splits) and count schedules with honest
burden strictly below the cliff's. Expected: 0 dominating schedules in 4,000
draws. Any violation prints a witness and exits nonzero.

Tags: [verified] = checked mechanically below; [internal] = closed-form step
derived in this header and spot-checked numerically.
"""
import sys
import numpy as np

rng = np.random.default_rng(20260816)

N_INSTANCES = 4000
RAND_SCHEDULES_PER_INSTANCE = 8
TOL = 1e-9


def honest_burden(g, delta_h):
    t = np.arange(len(g))
    return float(np.sum(delta_h ** t * g))


def deterrence(g, delta_f):
    t = np.arange(len(g))
    return float(np.sum(delta_f ** t * g))


def front_loaded(G_max, T):
    """The probation cliff: the whole deterrence requirement at t = 0."""
    g = np.zeros(T)
    g[0] = G_max          # delta_f^0 = 1, so (D) binds exactly
    return g


def scale_to_bind(g_shape, G_max, delta_f):
    """Scale a nonnegative shape so the deterrence constraint (D) binds.
    Binding is WLOG for the domination search: scaling down any slack
    schedule lowers its honest burden, so the binding version dominates it."""
    d = deterrence(g_shape, delta_f)
    assert d > 0.0, "degenerate all-zero schedule shape"
    return g_shape * (G_max / d)


def candidate_schedules(G_max, T, delta_f):
    """Random + structured adversarial schedules, all feasible with (D) tight."""
    cands = []
    for _ in range(RAND_SCHEDULES_PER_INSTANCE):
        shape = rng.gamma(shape=rng.uniform(0.3, 3.0), scale=1.0, size=T)
        if shape.sum() <= 0.0:
            continue
        cands.append(scale_to_bind(shape, G_max, delta_f))
    # structured adversaries: the shapes deferred-compensation instincts suggest
    cands.append(scale_to_bind(np.ones(T), G_max, delta_f))              # uniform ramp
    back = np.zeros(T); back[-1] = 1.0
    cands.append(scale_to_bind(back, G_max, delta_f))                     # pure back-load
    for t_split in (1, T // 2, T - 1):                                    # two-point splits
        for w in (0.25, 0.5, 0.75):
            g = np.zeros(T); g[0] = 1.0 - w; g[t_split] = g[t_split] + w
            cands.append(scale_to_bind(g, G_max, delta_f))
    return cands


print("=== B6 PROBATION CLIFF — random-search falsification (seed 20260816) ===")
print(f"  instances = {N_INSTANCES}; per-instance candidates = "
      f"{RAND_SCHEDULES_PER_INSTANCE} random + 11 structured")

dominations = 0
worst_margin = np.inf     # min over instances of (best candidate burden - cliff burden)
schedules_tested = 0

for i in range(N_INSTANCES):
    delta_h = rng.uniform(0.85, 0.99)
    delta_f = rng.uniform(0.20, 0.95) * delta_h          # strictly < delta_h
    T = int(rng.integers(6, 17))
    G_max = rng.uniform(1.0, 50.0)

    cliff = front_loaded(G_max, T)
    # [verified] the cliff is feasible and its burden equals G_max exactly
    assert abs(deterrence(cliff, delta_f) - G_max) < 1e-8
    assert abs(honest_burden(cliff, delta_h) - G_max) < 1e-8
    H_cliff = honest_burden(cliff, delta_h)

    for g in candidate_schedules(G_max, T, delta_f):
        schedules_tested += 1
        H_g = honest_burden(g, delta_h)
        margin = H_g - H_cliff
        worst_margin = min(worst_margin, margin)
        if H_g < H_cliff - TOL:
            dominations += 1
            print(f"  VIOLATION at instance {i}: delta_h={delta_h:.4f} "
                  f"delta_f={delta_f:.4f} T={T} G_max={G_max:.3f} "
                  f"H(g)={H_g:.6f} < H(cliff)={H_cliff:.6f}")

print(f"  schedules tested          = {schedules_tested}")
print(f"  dominating schedules      = {dominations}/{N_INSTANCES} instances "
      f"(expected 0)")
print(f"  min (H(g) - H(cliff))     = {worst_margin:+.3e}  (>= 0 means undominated)")

# ---------- exchange-argument spot check [internal, verified numerically] ----------
print("\n=== EXCHANGE STEP: moving gap mass later strictly raises the burden ===")
delta_h, delta_f, T, G_max = 0.95, 0.60, 10, 20.0
base = front_loaded(G_max, T)
H_prev = honest_burden(base, delta_h)
monotone = True
for t_late in range(1, T):
    g = np.zeros(T)
    g[t_late] = 1.0
    g = scale_to_bind(g, G_max, delta_f)   # all mass at t_late, (D) tight
    H_t = honest_burden(g, delta_h)
    ratio = (delta_h / delta_f) ** t_late
    # [internal] closed form: H = G_max * (delta_h/delta_f)^t_late
    assert abs(H_t - G_max * ratio) < 1e-6
    if H_t <= H_prev:
        monotone = False
    print(f"  all mass at t={t_late:2d}: H = {H_t:10.4f}  "
          f"(= G_max*(dh/df)^t = {G_max * ratio:10.4f})")
    H_prev = H_t
print("  strictly increasing in t: " + ("yes [verified]" if monotone else "NO — VIOLATION"))

# ---------- verdict ----------
print("\n=== VERDICT ===")
ok = (dominations == 0) and monotone and worst_margin >= -TOL
if ok:
    print("  [verified] 0 dominating schedules in 4,000 draws — the maximally")
    print("  front-loaded schedule (probation CLIFF) is undominated, matching")
    print("  the closed-form exchange argument (ratio (delta_f/delta_h)^t")
    print("  strictly decreasing => corner solution at t = 0).")
    sys.exit(0)
else:
    print("  FALSIFIED: a dominating schedule was found (or the exchange step")
    print("  failed to be monotone). The B6 claim does NOT survive; see the")
    print("  witness lines above.")
    sys.exit(1)
