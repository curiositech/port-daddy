#!/usr/bin/env python3
"""
B8 — The specialization boundary for sole-responsibility roles
==============================================================
Ledger item B8 (portfolio.tex §B8; whitepaper thm:specialization, Status: proposed).
Sweep-first, then exact derivation, then mutation. Exit nonzero on any violation.

MODEL. Requests for function F arrive Poisson(lam). Option S: sole specialist,
M/M/1 at rate mu_s. Option P: pool of c generalists, M/M/c at mu_g <= mu_s each.
Sole ownership yields accountability value A per period; waiting costs w per
job-unit-time. Pool utilization rho = lam/(c*mu_g); skill premium r = mu_s/mu_g.
Specialist net advantage rate: DeltaC = A + w*lam*(W_pool - W_solo)  (Little).

THM B8.1 (exact specialization boundary). With Erlang-C
  C(c,rho) = B_c / (1 - rho(1-B_c)),  B_k = a B_{k-1}/(k + a B_{k-1}), a = c*rho,
  W_solo = 1/(mu_s - lam),  W_pool = 1/mu_g + C(c,rho)/(c*mu_g - lam),
the specialist strictly wins iff  r >= g_A(rho,c) where
  g_A(rho,c) = c*rho + 1 / ( 1 + C(c,rho)/(c(1-rho)) + Atilde ),  Atilde = A*mu_g/(w*lam).
At A=0 this is the pure latency boundary g(rho,c) = c*rho + c(1-rho)/(c(1-rho)+C(c,rho)),
with g(rho,1)=1, g(0+,c)=1, g(rho->1,c)=c (pooling folklore saturates at c, it does
NOT diverge), and the c=2 closed form g(rho,2) = 1 + 2*rho - rho^2.

FALSIFICATION ON RECORD. The whitepaper's proposed threshold
  g~(rho,c) = 1 + (c-1)*lam/(c*mu_g - lam) = 1 + (c-1)*rho/(1-rho)
is FALSE AS STATED in both directions: too low at small rho (c=2, rho=0.1:
g~=1.111 < g=1.190 — it certifies specialists who actually lose) and too high at
large rho (c=2, rho=0.5: g~=2 > g=1.75; g~ diverges as rho->1 while the truth
saturates at c). For c=2 they cross at rho = (3-sqrt(5))/2 ≈ 0.38197.

THM B8.2 (price of the succession rule). Specialist subject to breakdowns at
rate xi at ALL times (death/heartbeat model), repair (successor spin-up) Exp(eta),
preemptive-resume, arrivals keep queueing: with mu_eff = mu_s*eta/(xi+eta),
  W_bd = (1 + mu_s*xi/(xi+eta)^2) / (mu_eff - lam)          [exact; Mitrany--Avi-Itzhak lineage]
        = 1/(mu_eff-lam) + Winf * mu_eff/(mu_eff-lam),  Winf = xi/(eta*(xi+eta)).
W_bd is decreasing in mu_s with infimum Winf (an INFINITELY skilled specialist
still makes arrivals eat residual downtime). Hence pooling dominates at EVERY
skill premium iff Winf > K := A/(w*lam) + W_pool(rho,c), i.e. iff
  xi * E[repair] = xi/eta  >  D* = eta*K/(1 - eta*K)     (D* = +inf if eta*K >= 1).
D* is the PRICE OF THE SUCCESSION RULE: a sole-responsibility role without a
succession plan is viable only while its death-rate x mean-succession-time
product stays below D*; fast succession (large eta) is what keeps D* above the
role's measured mortality — beyond D*, no skill premium rescues sole ownership.

Wrong turn on record: the naive decomposition W_bd = 1/(mu_eff-lam) + Winf is
refuted numerically (misses congestion amplification mu_eff/(mu_eff-lam):
downtime also builds queue). Seed 20260816 throughout.
"""
import sys, heapq
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

SEED = 20260816
FAIL = 0
def check(name, ok, detail=""):
    global FAIL
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  {detail}" if detail else ""))
    if not ok: FAIL += 1

# ---------- exact formulas ----------
def erlang_c(c, a):
    """P(wait) for M/M/c at offered load a = lam/mu (Erlang-B recursion, stable)."""
    B = 1.0
    for k in range(1, c + 1):
        B = a * B / (k + a * B)
    rho = a / c
    return B / (1 - rho * (1 - B))

def W_mm1(lam, mu):            return 1.0 / (mu - lam)
def W_mmc(lam, mu, c):
    a = lam / mu
    return 1.0 / mu + erlang_c(c, a) / (c * mu - lam)

def g_exact(rho, c):
    C = erlang_c(c, c * rho)
    return c * rho + c * (1 - rho) / (c * (1 - rho) + C)

def g_shift(rho, c, At):       # accountability-shifted boundary, At = A*mu_g/(w*lam)
    C = erlang_c(c, c * rho)
    return c * rho + 1.0 / (1.0 + C / (c * (1 - rho)) + At)

def g_proposed(rho, c):        # whitepaper's proposed threshold (to be falsified)
    return 1 + (c - 1) * rho / (1 - rho)

def W_breakdown(lam, mu, xi, eta):
    """Exact M/M/1-with-breakdowns mean sojourn (failures at all times, Exp repair)."""
    mu_eff = mu * eta / (xi + eta)
    if lam >= mu_eff: return np.inf
    return (1 + mu * xi / (xi + eta) ** 2) / (mu_eff - lam)

def delta_cost(A, w, lam, W_pool, W_solo):
    return A + w * lam * (W_pool - W_solo)

# ---------- independent numerics for the breakdown queue ----------
def W_breakdown_mg(lam, mu, xi, eta):
    """QBD matrix-geometric solve; phases (up, down)."""
    A0 = lam * np.eye(2)
    A2 = np.array([[mu, 0.0], [0.0, 0.0]])
    A1 = np.array([[-(lam + xi + mu), xi], [eta, -(lam + eta)]])
    A1inv = np.linalg.inv(A1)
    R = np.zeros((2, 2))
    for _ in range(500000):
        Rn = -(A0 + R @ R @ A2) @ A1inv
        if np.abs(Rn - R).max() < 1e-15: R = Rn; break
        R = Rn
    B1 = np.array([[-(lam + xi), xi], [eta, -(lam + eta)]])
    M = np.zeros((4, 4))
    M[:2, :2] = B1; M[:2, 2:] = A0
    M[2:, :2] = A2; M[2:, 2:] = A1 + R @ A2
    Mt = M.T.copy()
    IR = np.linalg.inv(np.eye(2) - R)
    Mt[0, :] = np.concatenate([np.ones(2), IR @ np.ones(2)])   # normalization row
    b = np.zeros(4); b[0] = 1
    pi = np.linalg.solve(Mt, b)
    L = pi[2:] @ (IR @ IR) @ np.ones(2)
    return L / lam

def W_breakdown_trunc(lam, mu, xi, eta, N=600):
    """Brute truncated-CTMC stationary solve (second independent method)."""
    S = 2 * (N + 1)
    Q = np.zeros((S, S))
    idx = lambda n, ph: 2 * n + ph
    for n in range(N + 1):
        i = idx(n, 0); j = idx(n, 1)
        if n < N: Q[i, idx(n + 1, 0)] += lam; Q[j, idx(n + 1, 1)] += lam
        if n > 0: Q[i, idx(n - 1, 0)] += mu
        Q[i, j] += xi; Q[j, i] += eta
    np.fill_diagonal(Q, -Q.sum(axis=1))
    M = Q.T.copy(); M[0, :] = 1.0
    b = np.zeros(S); b[0] = 1
    pi = np.linalg.solve(M, b)
    return (pi * np.repeat(np.arange(N + 1), 2)).sum() / lam

# ---------- simulators (the meters) ----------
def sim_mgc(lam, mu, c, n_jobs, rng, nb=15):
    """FCFS M/M/c discrete-event sim (earliest-free-server heap). Returns (W, se)."""
    arr = np.cumsum(rng.exponential(1 / lam, n_jobs))
    sv  = rng.exponential(1 / mu, n_jobs)
    free = [0.0] * c; heapq.heapify(free)
    soj = np.empty(n_jobs)
    for i in range(n_jobs):
        t0 = heapq.heappop(free)
        st = arr[i] if arr[i] > t0 else t0
        d = st + sv[i]; soj[i] = d - arr[i]
        heapq.heappush(free, d)
    s = soj[n_jobs // 10:]
    bs = len(s) // nb
    bm = s[:nb * bs].reshape(nb, bs).mean(axis=1)
    return s.mean(), bm.std(ddof=1) / np.sqrt(nb)

def sim_breakdown(lam, mu, xi, eta, n_events, rng, nb=15):
    """Gillespie CTMC sim of M/M/1-with-breakdowns; W via Little on batch time-averages."""
    t = 0.0; n = 0; up = True
    per = n_events // nb
    areas = np.zeros(nb); times = np.zeros(nb)
    exps = rng.exponential(1.0, n_events); unis = rng.random(n_events)
    b = 0
    for k in range(n_events):
        r_srv = mu if (n > 0 and up) else 0.0
        r_ph  = xi if up else eta
        tot = lam + r_srv + r_ph
        dt = exps[k] / tot
        areas[b] += n * dt; times[b] += dt; t += dt
        u = unis[k] * tot
        if u < lam: n += 1
        elif u < lam + r_srv: n -= 1
        else: up = not up
        if (k + 1) % per == 0 and b < nb - 1: b += 1
    Ls = areas[2:] / times[2:]                       # drop 2 warmup batches
    Ws = Ls / lam
    return Ws.mean(), Ws.std(ddof=1) / np.sqrt(len(Ws))

# =====================================================================
print("=== (1) SWEEP FIRST: attack the proposed threshold, then the exact one ===")
rng = np.random.default_rng(SEED)
# (1a) pure-arithmetic reduction check: sign(W_pool - W_solo) == sign(r - g(rho,c))
bad = 0
for _ in range(20000):
    c = int(rng.integers(1, 17)); rho = rng.uniform(0.02, 0.97)
    mu_g = rng.uniform(0.2, 3.0); lam = rho * c * mu_g
    r = c * rho + rng.uniform(0.01, 4.0); mu_s = r * mu_g
    lhs = W_mmc(lam, mu_g, c) - W_mm1(lam, mu_s)
    rhs = r - g_exact(rho, c)
    if abs(rhs) > 1e-9 and np.sign(lhs) != np.sign(rhs): bad += 1
check("reduction to r >= g(rho,c) form (20000 random instances)", bad == 0, f"{bad} sign mismatches")
# (1b) same for the A-shifted boundary
bad = 0
for _ in range(20000):
    c = int(rng.integers(1, 17)); rho = rng.uniform(0.02, 0.97)
    mu_g = rng.uniform(0.2, 3.0); lam = rho * c * mu_g
    r = c * rho + rng.uniform(0.01, 4.0); mu_s = r * mu_g
    A = rng.uniform(0, 3); w = rng.uniform(0.1, 5)
    dC = delta_cost(A, w, lam, W_mmc(lam, mu_g, c), W_mm1(lam, mu_s))
    rhs = r - g_shift(rho, c, A * mu_g / (w * lam))
    if abs(rhs) > 1e-9 and np.sign(dC) != np.sign(rhs): bad += 1
check("A-shifted boundary r >= g_A(rho,c) (20000 random instances)", bad == 0, f"{bad} sign mismatches")
# (1c) the proposed whitepaper threshold: count disagreements with truth
lo = hi = 0
for _ in range(20000):
    c = int(rng.integers(2, 17)); rho = rng.uniform(0.02, 0.97)
    ge, gp = g_exact(rho, c), g_proposed(rho, c)
    r = rng.uniform(min(ge, gp), max(ge, gp))        # probe the disputed strip
    if gp < r < ge: lo += 1                           # proposed certifies a losing specialist
    if ge < r < gp: hi += 1                           # proposed rejects a winning specialist
print(f"  proposed g~ vs exact g on the disputed strip: {lo} false-certify (low-rho), {hi} false-reject (high-rho)")
check("proposed threshold FALSIFIED both directions (counterexamples exist)", lo > 0 and hi > 0)
# named counterexamples, verified against simulation
for (cc, rho, r, tag) in [(2, 0.1, 1.15, "false-certify"), (2, 0.5, 1.90, "false-reject")]:
    mu_g = 1.0; lam = rho * cc * mu_g; mu_s = r * mu_g
    Ws, Wp = W_mm1(lam, mu_s), W_mmc(lam, mu_g, cc)
    prop = r > g_proposed(rho, cc); exact = r > g_exact(rho, cc)
    Whs, ses = sim_mgc(lam, mu_s, 1, 400000, np.random.default_rng([SEED, cc, 1]))
    Whp, sep = sim_mgc(lam, mu_g, cc, 400000, np.random.default_rng([SEED, cc, 2]))
    z = (Whp - Whs) / np.sqrt(ses**2 + sep**2)
    print(f"  c={cc} rho={rho} r={r}: g~={g_proposed(rho,cc):.4f} says {'S' if prop else 'P'}, "
          f"g={g_exact(rho,cc):.4f} says {'S' if exact else 'P'}; "
          f"W_solo={Ws:.4f} W_pool={Wp:.4f}; sim z(W_pool-W_solo)={z:+.1f}")
    check(f"counterexample ({tag}) confirmed by simulation", (z > 4) == exact and prop != exact)
rr = (3 - np.sqrt(5)) / 2
check("c=2 crossing of g~ and g at rho=(3-sqrt5)/2", abs(g_exact(rr, 2) - g_proposed(rr, 2)) < 1e-9,
      f"rho={rr:.5f}, g=g~={g_exact(rr,2):.5f}")

print("\n=== (2) METER AUDIT: Erlang-C and the breakdown queue vs independent numerics ===")
for (c, rho) in [(2, 0.5), (4, 0.7), (8, 0.3)]:
    mu = 1.0; lam = rho * c * mu
    Wth = W_mmc(lam, mu, c)
    Wh, se = sim_mgc(lam, mu, c, 300000, np.random.default_rng([SEED, c, 99]))
    z = (Wh - Wth) / se
    check(f"Erlang-C W_pool vs DES (c={c}, rho={rho})", abs(z) < 5, f"W={Wth:.4f} sim={Wh:.4f} z={z:+.2f}")
mx_mg = mx_tr = 0.0
for _ in range(20):
    mu = rng.uniform(0.5, 8); xi = rng.uniform(0.02, 1.5); eta = rng.uniform(0.1, 3)
    lam = rng.uniform(0.05, 0.9) * mu * eta / (xi + eta)
    Wcf = W_breakdown(lam, mu, xi, eta)
    mx_mg = max(mx_mg, abs(Wcf - W_breakdown_mg(lam, mu, xi, eta)))
    mx_tr = max(mx_tr, abs(Wcf - W_breakdown_trunc(lam, mu, xi, eta)))
check("breakdown closed form vs matrix-geometric (20 random)", mx_mg < 1e-7, f"max|diff|={mx_mg:.2e}")
check("breakdown closed form vs truncated CTMC (20 random)", mx_tr < 1e-6, f"max|diff|={mx_tr:.2e}")
for (lam, mu, xi, eta) in [(1.0, 5.0, 0.5, 0.25), (0.5, 2.0, 0.1, 1.0)]:
    Wcf = W_breakdown(lam, mu, xi, eta)
    Wh, se = sim_breakdown(lam, mu, xi, eta, 600000, np.random.default_rng([SEED, int(10*mu)]))
    z = (Wh - Wcf) / se
    check(f"breakdown closed form vs Gillespie DES (mu={mu}, xi/eta={xi/eta:g})",
          abs(z) < 5, f"W={Wcf:.4f} sim={Wh:.4f} z={z:+.2f}")
# refuted naive decomposition, on record
lam, mu, xi, eta = 1.0, 5.0, 0.5, 0.25
naive = 1/(mu*eta/(xi+eta) - lam) + xi/(eta*(xi+eta))
check("naive decomposition REFUTED (wrong turn on record)",
      abs(naive - W_breakdown(lam, mu, xi, eta)) > 1,
      f"naive={naive:.4f} vs exact={W_breakdown(lam,mu,xi,eta):.4f}")

print("\n=== (3) THM B8.1 — the boundary g(rho,c), charted ===")
print("  g(rho,c) exact  [proposed g~ in brackets]:")
print("  rho\\c " + "".join(f"{c:>16d}" for c in (2, 4, 8, 16)))
for rho in (0.1, 0.3, 0.5, 0.7, 0.9):
    row = "".join(f"  {g_exact(rho,c):6.3f} [{g_proposed(rho,c):6.3f}]" for c in (2, 4, 8, 16))
    print(f"  {rho:.1f} " + row)
bad = max(abs(g_exact(rho, 2) - (1 + 2*rho - rho**2)) for rho in np.linspace(0.01, 0.99, 99))
check("c=2 closed form g(rho,2) = 1 + 2*rho - rho^2", bad < 1e-12, f"max|diff|={bad:.1e}")
check("g(rho,1) = 1 (identical queues need no premium)",
      max(abs(g_exact(x, 1) - 1) for x in np.linspace(0.01, 0.99, 50)) < 1e-12)
check("limits: g(0+,c)=1, g(1-,c)=c (folklore saturates, never diverges)",
      abs(g_exact(1e-9, 8) - 1) < 1e-6 and abs(g_exact(1 - 1e-9, 8) - 8) < 1e-5)

print("\n=== (4) FULL SWEEP: closed-form decision vs simulated cost difference ===")
sweep_rng = np.random.default_rng(SEED + 1)
n_dec = n_ind = n_bad = 0
for i in range(60):
    with_bd = i % 2 == 1
    while True:
        c = int(sweep_rng.integers(2, 9)); rho = sweep_rng.uniform(0.10, 0.85)
        mu_g = sweep_rng.uniform(0.5, 2.0); lam = rho * c * mu_g
        r = max(1.0, c * rho + 0.05) + sweep_rng.uniform(0, 2.5); mu_s = r * mu_g
        xi, eta = 0.0, 1.0
        if with_bd:
            xi = sweep_rng.uniform(0.02, 0.4) * mu_g; eta = sweep_rng.uniform(0.2, 2.0) * mu_g
        if lam < 0.92 * mu_s * eta / (xi + eta): break
    A = sweep_rng.uniform(0, 2); w = sweep_rng.uniform(0.2, 4)
    W_p = W_mmc(lam, mu_g, c)
    W_s = W_breakdown(lam, mu_s, xi, eta) if with_bd else W_mm1(lam, mu_s)
    dC = delta_cost(A, w, lam, W_p, W_s)
    Whp, sep = sim_mgc(lam, mu_g, c, 60000, np.random.default_rng([SEED, i, 0]))
    if with_bd:
        n_ev = min(400000, max(150000, int(2 * (lam + xi * eta / (xi + eta)) * 60000 / lam)))
        Whs, ses = sim_breakdown(lam, mu_s, xi, eta, n_ev, np.random.default_rng([SEED, i, 1]))
    else:
        Whs, ses = sim_mgc(lam, mu_s, 1, 60000, np.random.default_rng([SEED, i, 1]))
    dCh = delta_cost(A, w, lam, Whp, Whs)
    se = w * lam * np.sqrt(sep**2 + ses**2)
    if abs(dCh) > 5 * se:
        n_dec += 1
        if np.sign(dCh) != np.sign(dC):
            n_bad += 1
            print(f"  VIOLATION at instance {i}: closed-form dC={dC:+.3f}, sim dC={dCh:+.3f} +/- {se:.3f}")
    else:
        n_ind += 1
print(f"  60 instances (30 with breakdowns): {n_dec} decisive, {n_ind} near-boundary/indecisive")
check("closed-form boundary vs simulated cost sign: 0 violations", n_bad == 0, f"{n_bad} violations")
check("sweep had decisive power", n_dec >= 30, f"{n_dec} decisive")

print("\n=== (5) THM B8.2 — the breakdowns corner prices the succession rule ===")
lam, c, mu_g, A, w, eta = 1.0, 4, 1.2, 0.2, 1.0, 0.25
rho = lam / (c * mu_g); W_p = W_mmc(lam, mu_g, c)
K = A / (w * lam) + W_p
Dstar = eta * K / (1 - eta * K) if eta * K < 1 else np.inf
print(f"  instance: lam={lam}, c={c}, mu_g={mu_g} (rho={rho:.3f}), A={A}, w={w}, eta={eta}")
print(f"  W_pool={W_p:.4f}, K = A/(w*lam)+W_pool = {K:.4f}, eta*K={eta*K:.4f}")
print(f"  succession price D* = eta*K/(1-eta*K) = {Dstar:.4f}   (sole role viable only while xi/eta < D*)")
Winf = lambda xi: xi / (eta * (xi + eta))
xis = Dstar * eta
check("D* solves Winf(xi*) = K exactly", abs(Winf(xis) - K) < 1e-12, f"Winf(xi*)={Winf(xis):.6f}")
Whuge = W_breakdown_mg(lam, 1e8, xis * 1.5, eta)
check("above D*, even mu_s=1e8 loses to the pool (matrix-geometric)",
      Whuge - W_p > A / (w * lam), f"W_solo(mu=1e8)={Whuge:.4f} > K={K:.4f}")
Wlow = W_breakdown(lam, 1e8, xis * 0.5, eta)
check("below D*, an infinitely skilled specialist wins", Wlow - W_p < A / (w * lam),
      f"W_solo(mu=1e8)={Wlow:.4f} < K={K:.4f}")
mono = all(np.diff([W_breakdown(lam, m, 0.3, eta) for m in np.linspace(2.5, 200, 80)]) < 0)
check("W_bd decreasing in mu_s with infimum Winf (skill cannot buy back downtime)",
      mono and abs(W_breakdown(lam, 1e9, 0.3, eta) - Winf(0.3)) < 1e-4)

print("\n=== (6) MUTATION: forgetting the breakdown term must be caught at high xi ===")
def mutant_decision(A, w, lam, mu_s, mu_g, c, xi, eta):     # forgets (xi, eta) entirely
    return delta_cost(A, w, lam, W_mmc(lam, mu_g, c), W_mm1(lam, mu_s)) > 0
# high-xi canary: xi/eta = 2 >> D* = 0.349
mu_s, xi = 5.0, 0.5
Wtrue = W_breakdown(lam, mu_s, xi, eta)
dC_true = delta_cost(A, w, lam, W_p, Wtrue)
mut = mutant_decision(A, w, lam, mu_s, mu_g, c, xi, eta)
Whs, ses = sim_breakdown(lam, mu_s, xi, eta, 700000, np.random.default_rng([SEED, 777]))
Whp, sep = sim_mgc(lam, mu_g, c, 200000, np.random.default_rng([SEED, 778]))
dC_sim = delta_cost(A, w, lam, Whp, Whs)
se = w * lam * np.sqrt(sep**2 + ses**2)
print(f"  canary (xi={xi}, eta={eta}, xi/eta=2.0 > D*={Dstar:.3f}): mutant says "
      f"{'SPECIALIST' if mut else 'POOL'} (its W_solo={W_mm1(lam,mu_s):.3f}); "
      f"truth W_solo={Wtrue:.3f}, dC_true={dC_true:+.3f}, sim dC={dC_sim:+.3f} +/- {se:.3f}")
caught = mut and (dC_sim < -5 * se) and dC_true < 0
check("mutant CAUGHT by high-xi instance (sim decisively contradicts it)", caught)
# low-xi control: mutation invisible — proves the high-xi canary is load-bearing
xi_lo = 0.01; eta_lo = 1.0
agree = mutant_decision(A, w, lam, mu_s, mu_g, c, xi_lo, eta_lo) == \
        (delta_cost(A, w, lam, W_p, W_breakdown(lam, mu_s, xi_lo, eta_lo)) > 0)
check("low-xi control: mutant indistinguishable there (canary is load-bearing)", agree)

# ---------- figure ----------
fig, ax = plt.subplots(1, 3, figsize=(16.5, 4.6))
rs = np.linspace(0.005, 0.985, 300)
for c_, col in zip([2, 4, 8, 16], ['#1e466e', '#1f6e46', '#c78a1e', '#8c1e1e']):
    ax[0].plot(rs, [g_exact(x, c_) for x in rs], color=col, lw=2, label=f'$g(\\rho,{c_})$ exact')
    ax[0].plot(rs, [g_proposed(x, c_) for x in rs], color=col, lw=1, ls=':')
ax[0].set_ylim(0.9, 18); ax[0].set_yscale('log')
ax[0].set_xlabel('pool utilization $\\rho$'); ax[0].set_ylabel('required skill premium $\\mu_s/\\mu_g$')
ax[0].set_title('Panel A — the specialization boundary\nexact $g$ saturates at $c$; proposed form (dotted) diverges', fontsize=11)
ax[0].legend(fontsize=8); ax[0].grid(alpha=.25, which='both')

xr = np.linspace(1e-3, 3.0, 400)
for r_, col in zip([2, 4, 8, np.inf], ['#c78a1e', '#1e466e', '#1f6e46', '#8c1e1e']):
    y = []
    for x in xr:
        Wb = Winf(x * eta) if np.isinf(r_) else W_breakdown(lam, r_ * mu_g, x * eta, eta)
        y.append(delta_cost(A, w, lam, W_p, Wb))
    lbl = '$\\mu_s/\\mu_g=\\infty$ (envelope)' if np.isinf(r_) else f'$\\mu_s/\\mu_g={r_}$'
    ax[1].plot(xr, y, color=col, lw=2, label=lbl)
ax[1].axhline(0, color='k', lw=0.8); ax[1].axvline(Dstar, color='#8c1e1e', ls=':', lw=1.2)
ax[1].text(Dstar + 0.04, -2.5, f'$D^*$={Dstar:.3f}', color='#8c1e1e', fontsize=9, rotation=90)
ax[1].set_ylim(-4, 1.2); ax[1].set_xlabel('$\\xi\\,E[\\mathrm{repair}] = \\xi/\\eta$')
ax[1].set_ylabel('specialist advantage $\\Delta C$')
ax[1].set_title('Panel B — the succession price\nabove $D^*$ pooling wins at EVERY skill premium', fontsize=11)
ax[1].legend(fontsize=8.5); ax[1].grid(alpha=.25)

sc_rng = np.random.default_rng(SEED + 2)
pts_x, pts_y = [], []
for i in range(40):
    c_ = int(sc_rng.integers(2, 9)); rho_ = sc_rng.uniform(0.1, 0.85); mu_g_ = 1.0
    lam_ = rho_ * c_ * mu_g_; r_ = max(1.0, c_ * rho_ + 0.05) + sc_rng.uniform(0, 2.5)
    A_ = sc_rng.uniform(0, 2); w_ = sc_rng.uniform(0.2, 4)
    dC_ = delta_cost(A_, w_, lam_, W_mmc(lam_, mu_g_, c_), W_mm1(lam_, r_ * mu_g_))
    Wp_, _ = sim_mgc(lam_, mu_g_, c_, 40000, np.random.default_rng([SEED, 500 + i, 0]))
    Ws_, _ = sim_mgc(lam_, r_ * mu_g_, 1, 40000, np.random.default_rng([SEED, 500 + i, 1]))
    pts_x.append(dC_); pts_y.append(delta_cost(A_, w_, lam_, Wp_, Ws_))
lim = max(map(abs, pts_x + pts_y)) * 1.05
ax[2].plot([-lim, lim], [-lim, lim], color='k', lw=0.8)
ax[2].scatter(pts_x, pts_y, s=18, color='#1e466e', alpha=0.8)
ax[2].axhline(0, color='k', lw=0.5, ls=':'); ax[2].axvline(0, color='k', lw=0.5, ls=':')
ax[2].set_xlabel('closed-form $\\Delta C$'); ax[2].set_ylabel('simulated $\\Delta C$')
ax[2].set_title('Panel C — sweep concordance\nno off-diagonal quadrant escapes (seed 20260816)', fontsize=11)
ax[2].grid(alpha=.25)
plt.tight_layout(); plt.savefig('b8_figure.png', dpi=150, bbox_inches='tight')
print("\nFigure saved to b8_figure.png")

print(f"\n{'ALL CHECKS PASSED' if FAIL == 0 else f'{FAIL} CHECK(S) FAILED'}")
sys.exit(1 if FAIL else 0)
