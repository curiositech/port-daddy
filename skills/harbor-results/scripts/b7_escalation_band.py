#!/usr/bin/env python3
"""
B7 — Costly-escalation signaling: threshold equilibrium + the debit tuning band
===============================================================================
Portfolio §B7 / whitepaper §escalation ("crying wolf has a price"). Setting:
an agent privately observes urgency u ~ F on [0,1]. Escalating surfaces the
item on the operator's reserved distress lane; the operator validates with
probability V(u) (increasing — genuine urgency is revealed on attention).
A DISMISSED escalation debits the agent's standing by delta, worth w per unit
of future surfacing weight. Escalating when urgent yields benefit b(u),
increasing. Not escalating yields 0. Escalation payoff:

    Pi_delta(u) = b(u) - delta*w*(1 - V(u))                              (Pi)

THEOREM 1 (threshold equilibrium). If b is strictly increasing and V is
nondecreasing, Pi_delta is strictly increasing in u, hence crosses 0 at most
once. With Pi_delta(0) < 0 < Pi_delta(1) there is a unique u*(delta) solving
b(u*) = delta*w*(1 - V(u*)), and the unique best response is the THRESHOLD
rule "escalate iff u >= u*(delta)" — a separating equilibrium in the Spence
mold: the dismissal debit is money-burning only high-urgency types risk.
(Corner cases: Pi(0) >= 0 => u* = 0, all escalate; Pi(1) <= 0 => u* = 1,
silence.)

THEOREM 2 (monotone comparative statics). u*(delta) is nondecreasing in
delta; at an interior differentiable crossing,

    du*/ddelta = w*(1 - V(u*)) / (b'(u*) + delta*w*V'(u*))  >= 0,        (CS)

strict whenever V(u*) < 1. Closed forms for the worked family
(u ~ Uniform[0,1], b(u) = u, V(u) = u):
    u*(delta) = delta*w / (1 + delta*w).                                 (U*)

THEOREM 3 (the tuning band). With R3's expected-loss constants (c_att per
attended escalation, C_fa per dismissed one, C_miss per silenced genuine
distress; u_crit = (c_att+C_fa)/(C_miss+C_fa) the R3/SDT posterior at which
inspection becomes rational, identifying V(u) with the calibrated posterior),
define per-item
    alarm load  L(delta)  = INT_{u*}^{1} [c_att + C_fa*(1-V(u))] dF(u)
    miss loss   ML(delta) = C_miss * max(0, F(u*(delta)) - F(u_crit)).
L is nonincreasing and ML nondecreasing in delta (both via Thm 2), so the
feasible set {delta : L <= A, ML <= M} is an INTERVAL [delta_min, delta_max]:
below delta_min the operator's alarm-fatigue budget A is violated; above
delta_max the distress lane silences more genuine-distress mass than the miss
budget M tolerates. Uniform-linear closed forms (w=1):
    L(delta) = c_att*(1-u*) + C_fa*(1-u*)^2/2,
    delta_of(u*) = u*/(1-u*),
    delta_min = delta_of(1 - x_A), x_A = (-c_att + sqrt(c_att^2+2*C_fa*A))/C_fa
                (0 if even delta=0 fits the budget),
    delta_max = delta_of(min(u_crit + M/C_miss, 1)).
The band can be EMPTY: L(delta_max) > A means no debit works — the channel is
under-provisioned (fix capacity or evidence quality V, not delta).

FALSIFICATION (this script, sweep-first):
  S1  closed-form vs bisection agreement (uniform-linear + exponential/
      Lambert-W instance u*e^{u*} = delta*w).
  S2  monotone sweep: random monotone (b,V) power families x random delta —
      assert at most one sign change of Pi and u*(delta) nondecreasing.
      Expected: 0 violations.
  S3  ATTACK on single-crossing: random non-monotone b or V (sinusoidal
      wiggle). Expected: many multi-crossing instances — the escalation set
      becomes a union of intervals (a mid-urgency type escalates while a
      HIGHER-urgency type stays silent). The monotonicity condition earns
      its keep; the attack must land at least once or the sweep itself is
      broken.
  S4  band: R3 constants (C_miss=100, c_att=1, C_fa=5 => u_crit = 6/105),
      w=1, M=1. A=3.3 => NONEMPTY band; A=2.0 => EMPTY band. Numeric
      feasible set on a delta-grid must be a contiguous interval matching
      the closed-form endpoints.
  S5  mutations: zero-debit mutant must blow the alarm-fatigue budget
      (L(0)=3.5 > A); excessive-debit mutant (delta = 1.0 ≈ 14x delta_max)
      must silence genuine distress (ML >> M). Both must be CAUGHT.
Any violation prints a witness and exits nonzero.

Tags: [verified] = closed form checked mechanically below; [internal] =
regenerates from this script at seed 20260816.
"""
import sys
import numpy as np

rng = np.random.default_rng(20260816)
TOL = 1e-9
failures = []


def check(ok, label):
    print(f"  {'[verified]' if ok else 'VIOLATION '} {label}")
    if not ok:
        failures.append(label)


def u_star(b, V, delta, w, lo=0.0, hi=1.0, iters=200):
    """Threshold via bisection on Pi(u) = b(u) - delta*w*(1-V(u)).
    Assumes Pi increasing (Thm 1 regime). Returns lo/hi at corners."""
    def Pi(u):
        return b(u) - delta * w * (1.0 - V(u))
    if Pi(lo) >= 0.0:
        return lo
    if Pi(hi) <= 0.0:
        return hi
    a, c = lo, hi
    for _ in range(iters):
        m = 0.5 * (a + c)
        if Pi(m) < 0.0:
            a = m
        else:
            c = m
    return 0.5 * (a + c)


def sign_changes(b, V, delta, w, grid):
    Pi = b(grid) - delta * w * (1.0 - V(grid))
    s = np.sign(Pi)
    s = s[s != 0]
    return int(np.sum(s[1:] != s[:-1]))


# ---------- S1: closed forms vs bisection --------------------------------
print("=== S1  CLOSED FORMS vs BISECTION (seed 20260816) ===")
lin = lambda u: u
ok = True
for delta in (0.05, 0.2, 1.0, 5.0):
    for w in (0.5, 1.0, 2.0):
        cf = delta * w / (1.0 + delta * w)                       # (U*)
        num = u_star(lin, lin, delta, w)
        ok &= abs(cf - num) < 1e-10
check(ok, "uniform-linear u* = delta*w/(1+delta*w) matches bisection (12 pts)")

# exponential instance: b(u)=u, V(u)=1-e^{-u} on [0,50]; u* solves u e^u = dw
ok = True
for dw in (0.5, 1.0, 5.0):
    num = u_star(lambda u: u, lambda u: 1.0 - np.exp(-u), dw, 1.0, hi=50.0)
    x = 0.5 if dw < np.e else np.log(dw)                          # Newton for W(dw)
    for _ in range(60):
        x = x - (x * np.exp(x) - dw) / (np.exp(x) * (1.0 + x))
    ok &= abs(num - x) < 1e-8
check(ok, "exponential instance u* = LambertW(delta*w) (u e^u = dw), 3 pts")

# comparative-statics formula (CS) vs numeric derivative at an interior point
delta, w, h = 0.2, 1.0, 1e-6
us = u_star(lin, lin, delta, w)
num_d = (u_star(lin, lin, delta + h, w) - u_star(lin, lin, delta - h, w)) / (2 * h)
cs = w * (1.0 - us) / (1.0 + delta * w)          # b'=1, V'=1
check(abs(num_d - cs) < 1e-5, f"(CS) du*/ddelta = {cs:.6f} matches numeric {num_d:.6f}")

# ---------- S2: monotone sweep — single crossing + monotone statics -------
print("\n=== S2  MONOTONE SWEEP: 4000 random monotone (b,V) families ===")
N_MONO = 4000
grid = np.linspace(0.0, 1.0, 2001)
sc_bad = mono_bad = 0
for i in range(N_MONO):
    alpha = rng.uniform(0.3, 3.0); p = rng.uniform(0.4, 2.5)
    vmax = rng.uniform(0.4, 1.0); q = rng.uniform(0.4, 3.0)
    w = rng.uniform(0.3, 3.0)
    b = lambda u, a=alpha, p=p: a * u ** p
    V = lambda u, v=vmax, q=q: v * u ** q
    deltas = np.sort(rng.uniform(0.01, 5.0, size=4))
    prev = -1.0
    for delta in deltas:
        if sign_changes(b, V, delta, w, grid) > 1:
            sc_bad += 1
            print(f"  VIOLATION i={i}: >1 sign change (a={alpha:.3f} p={p:.3f} "
                  f"v={vmax:.3f} q={q:.3f} w={w:.3f} d={delta:.3f})")
        us = u_star(b, V, delta, w)
        if us < prev - 1e-9:
            mono_bad += 1
            print(f"  VIOLATION i={i}: u* decreased in delta ({prev:.6f} -> {us:.6f})")
        prev = us
check(sc_bad == 0, f"single crossing: 0/{N_MONO} instances with >1 sign change "
                   f"(got {sc_bad})")
check(mono_bad == 0, f"u*(delta) nondecreasing: 0/{N_MONO} violations (got {mono_bad})")

# ---------- S3: attack — non-monotone families break the threshold --------
print("\n=== S3  ATTACK: non-monotone b or V (the condition earns its keep) ===")
N_ATK = 2000
multi = 0
witness = None
for i in range(N_ATK):
    amp = rng.uniform(0.1, 0.6); k = int(rng.integers(2, 7))
    w = rng.uniform(0.3, 2.0); delta = rng.uniform(0.1, 3.0)
    if rng.uniform() < 0.5:   # wiggle the benefit
        b = lambda u, a=amp, k=k: u + a * np.sin(2 * np.pi * k * u)
        V = lambda u: u
    else:                     # wiggle the validation probability
        b = lambda u: u
        V = lambda u, a=amp, k=k: np.clip(u + a * np.sin(2 * np.pi * k * u), 0, 1)
    nsc = sign_changes(b, V, delta, w, grid)
    if nsc > 1:
        multi += 1
        if witness is None:
            Pi = b(grid) - delta * w * (1.0 - V(grid))
            esc = Pi >= 0.0
            hi_silent = np.where(~esc & (np.cumsum(esc) > 0))[0]
            lo_loud = np.where(esc)[0]
            witness = (i, amp, k, w, delta, grid[lo_loud[0]], grid[hi_silent[0]])
check(multi > 0, f"attack landed: {multi}/{N_ATK} non-monotone instances have "
                 f">1 crossing (threshold equilibrium FAILS there)")
if witness:
    i, amp, k, w, delta, u_lo, u_hi = witness
    print(f"  witness i={i}: amp={amp:.3f} k={k} w={w:.3f} delta={delta:.3f} — "
          f"type u={u_lo:.3f} escalates while HIGHER type u={u_hi:.3f} is silent")
    print("  => escalation set is a union of intervals: non-monotone signaling, "
          "no separating threshold")

# ---------- S4: the tuning band on R3's worked instance -------------------
print("\n=== S4  TUNING BAND — R3 constants C_miss=100, c_att=1, C_fa=5 ===")
C_MISS, C_ATT, C_FA = 100.0, 1.0, 5.0
U_CRIT = (C_ATT + C_FA) / (C_MISS + C_FA)     # R3 posterior threshold = 6/105
M_BUDGET = 1.0                                 # miss budget, R3 loss units
W = 1.0
print(f"  u_crit = (c_att+C_fa)/(C_miss+C_fa) = {U_CRIT:.6f}  (= 6/105, R3)")

ustar_u = lambda d: d * W / (1.0 + d * W)
delta_of = lambda u: u / (W * (1.0 - u))

def L_closed(d):
    x = 1.0 - ustar_u(d)
    return C_ATT * x + C_FA * x * x / 2.0

def L_numeric(d):
    us = u_star(lin, lin, d, W)
    g = np.linspace(us, 1.0, 20001)
    return float(np.trapezoid(C_ATT + C_FA * (1.0 - g), g))

def miss_loss(d):
    return C_MISS * max(0.0, ustar_u(d) - U_CRIT)

ok = all(abs(L_closed(d) - L_numeric(d)) < 1e-6 for d in (0.0, 0.05, 0.5, 2.0))
check(ok, "alarm load closed form L = c_att(1-u*) + C_fa(1-u*)^2/2 matches "
          "quadrature (4 pts)")

def band(A):
    u_max = min(U_CRIT + M_BUDGET / C_MISS, 1.0 - 1e-12)
    d_max = delta_of(u_max)
    if L_closed(0.0) <= A:
        d_min = 0.0
    else:
        x_A = (-C_ATT + np.sqrt(C_ATT ** 2 + 2.0 * C_FA * A)) / C_FA
        d_min = delta_of(1.0 - x_A)
    return d_min, d_max

for A, want_nonempty in ((3.3, True), (2.0, False)):
    d_min, d_max = band(A)
    nonempty = d_min <= d_max + TOL
    print(f"  A = {A:.1f}: delta_min = {d_min:.6f}, delta_max = {d_max:.6f} "
          f"-> band {'NONEMPTY' if nonempty else 'EMPTY'}")
    check(nonempty == want_nonempty,
          f"A={A}: band is {'nonempty' if want_nonempty else 'EMPTY'} as claimed")
    # numeric feasibility grid: the feasible set must be exactly the interval
    dgrid = np.linspace(0.0, 0.6, 1201)
    feas = np.array([(L_closed(d) <= A + TOL) and (miss_loss(d) <= M_BUDGET + TOL)
                     for d in dgrid])
    idx = np.where(feas)[0]
    contiguous = (len(idx) == 0) or (idx[-1] - idx[0] + 1 == len(idx))
    check(contiguous, f"A={A}: feasible set on 1201-pt grid is contiguous "
                      f"(interval structure, Thm 3)")
    if want_nonempty:
        lo, hi = dgrid[idx[0]], dgrid[idx[-1]]
        step = dgrid[1] - dgrid[0]
        check(abs(lo - d_min) <= step and abs(hi - d_max) <= step,
              f"A={A}: grid endpoints [{lo:.4f},{hi:.4f}] match closed form "
              f"[{d_min:.4f},{d_max:.4f}] within one grid step")
        d_mid = 0.5 * (d_min + d_max)
        check(L_closed(d_mid) <= A and miss_loss(d_mid) <= M_BUDGET,
              f"A={A}: interior point delta={d_mid:.4f} satisfies BOTH constraints"
              f" (L={L_closed(d_mid):.3f}<=A, ML={miss_loss(d_mid):.3f}<=M)")
    else:
        check(len(idx) == 0, f"A={A}: grid confirms NO feasible delta "
                             f"(under-provisioned channel; fix A or V, not delta)")

# ---------- S5: mutations — both failure modes must be CAUGHT -------------
print("\n=== S5  MUTATIONS: the band's two walls have teeth ===")
A = 3.3
d_min, d_max = band(A)
# zero-debit mutant: free escalation
esc_rate0 = 1.0 - ustar_u(0.0)          # 1 - F(u*)
L0 = L_closed(0.0)
print(f"  zero-debit mutant: escalation rate = {esc_rate0:.3f} (everyone), "
      f"L(0) = {L0:.3f} vs budget A = {A}")
check(L0 > A + TOL, "zero-debit mutant CAUGHT: alarm-fatigue budget blown "
                    f"(L(0)={L0:.3f} > {A}) — the Cvach habituation regime")
# excessive-debit mutant
d_big = 1.0
usb = ustar_u(d_big)
mlb = miss_loss(d_big)
print(f"  excessive-debit mutant delta={d_big:.1f} (~{d_big/d_max:.0f}x delta_max): "
      f"u* = {usb:.3f}, deterred genuine mass = {usb - U_CRIT:.3f}, "
      f"miss loss = {mlb:.2f} vs M = {M_BUDGET}")
check(mlb > M_BUDGET + TOL, "excessive-debit mutant CAUGHT: genuine distress "
                            f"silenced (ML={mlb:.2f} >> {M_BUDGET})")
check(L_closed(d_big) <= A, "  (and it 'passes' the fatigue wall alone — one-sided "
                            "tuning would MISS it: both walls are critical)")

# ---------- verdict -------------------------------------------------------
print("\n=== VERDICT ===")
if not failures:
    print("  [verified] threshold equilibrium + monotone statics survive 4000")
    print("  monotone draws; the attack breaks non-monotone families as the")
    print("  theorem's condition predicts; the band [delta_min, delta_max] is an")
    print(f"  interval, nonempty at A=3.3 ([{band(3.3)[0]:.4f}, {band(3.3)[1]:.4f}]),")
    print("  EMPTY at A=2.0 (honest boundary); both mutants caught.")
    sys.exit(0)
else:
    print(f"  FALSIFIED: {len(failures)} violation(s):")
    for f in failures:
        print(f"    - {f}")
    sys.exit(1)
