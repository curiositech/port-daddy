#!/usr/bin/env python3
"""
B5 — Engine substitution: Akerlof unraveling inside one identity,
     and resurrection soundness
==================================================================
Portfolio §B5 / doc3 B5 / Paper 5 ("Continuity Without Metaphysics").

SETTING. Two engine qualities theta_H > theta_L with per-outcome operating
costs c_H > c_L (write D_theta = theta_H - theta_L, D_c = c_H - c_L). An
identity carries reputation r earned under some engine history; buyers
observe r but, absent attestation, NOT the engine currently behind the
identity. A strategic principal may swap theta_L in after building r on
theta_H. Interesting regime: theta_L < c_H < theta_H (the strong engine
does not pay at the weak engine's price) and D_theta > D_c (the strong
engine is socially efficient).

(1) THEOREM B5.1 (Akerlof unraveling inside one identity; no attestation).
    (a) Substitution dominance: the period-2 price p depends only on buyer
        beliefs, never on the actual engine, so the swap gain
            (p - c_L) - (p - c_H) = D_c > 0
        is PRICE-INDEPENDENT. No belief supports pooling on theta_H; the
        strategic type substitutes with probability 1 (sigma* = 0), and no
        separating equilibrium exists (the deviation is costless and
        invisible, so there is nothing to signal with).
    (b) Mixture discount and the unraveling threshold: with a committed
        fraction mu of high-r identities (honest theta_H types who never
        swap), buyers price p(mu) = mu*theta_H + (1-mu)*theta_L. Committed
        participation requires p(mu) >= c_H, i.e.
            mu >= mu* = (c_H - theta_L) / (theta_H - theta_L).
        Below mu* the committed types exit (or substitute), mu falls, the
        price falls further — Akerlof's death spiral run INSIDE one
        identity — and the market rests at price theta_L. With
        heterogeneous committed costs the spiral is a monotone-decreasing
        iteration converging to the Akerlof fixed point (possibly 0).
    (c) Deterrence without attestation needs an audited stake: if the swap
        is detected w.p. q and forfeits stake W, pooling on theta_H
        survives iff q*W >= D_c (the price cancels out of the IC).

(2) THEOREM B5.2 (the IC flip under daemon-attested engine ids).
    With engine attestation on every witnessed outcome, reputation keys on
    (principal, engine); a swapped-in engine trades at its OWN key's price,
    so the swap gain becomes
        (theta_L - c_L) - (theta_H - c_H) = D_c - D_theta,
    negative exactly when the strong engine is efficient. Attestation
    flips "swap iff D_c > 0" (always profitable) into "swap iff
    D_c > D_theta" (profitable only when the weak engine is the socially
    better engine — the planner's own rule), and the required audit stake
    drops from W* = D_c/q to W* = 0. The information asymmetry, not the
    substitution, was the defect.

(3) THEOREM B5.3 (resurrection soundness). Let M be sanction-respecting
    (spawn-to-person Def. III.6.1 / def:sanction-respecting: some penalty
    Delta > 0 such that a dishonest witnessed outcome reduces the score
    the actor can act under by >= Delta for a non-trivial window, relative
    to never having produced the outcome). Extend M with provider
    migration that enforces
       (i)  credential + continuity-witness verification (the successor is
            the SAME identity: score history, sanction ledger carried),
       (ii) engine attestation in successor outcomes (reputation keys stay
            (principal, engine); no post-migration engine relabeling),
       (iii) open commitments closed or renegotiated with escrow delta
            (in-flight liabilities and their forfeitable escrow follow the
            successor).
    Then the extended mechanism is sanction-respecting with the same
    Delta: migration is a no-op on the sanction algebra. Dropping any one
    clause admits an escape, each exhibited below by a machine-found
    shortest counterexample trace:
       drop (i)   -> whitewash-by-resurrection (sanction ledger shed),
       drop (ii)  -> engine-history shedding (run theta_L, trade on the
                     theta_H key — the Part-1 lemons attack resurrected
                     across the migration boundary),
       drop (iii) -> liability stranding (abandon an open commitment by
                     migrating; the escrow refunds, the default lands on
                     nobody).
    SCOPE LEMMA (wrong turn, kept as mutant m0): sanctions must be
    IDENTITY-scoped even though pricing is (principal, engine)-keyed. A
    first modeling pass keyed sanctions like scores — per (identity,
    engine) — and the intact protocol then fails Def. III.6.1 in ONE step
    with no migration at all: the sibling engine key inside the same
    identity is a free escape hatch (accessible score = the un-sanctioned
    key's r0). One rule closes both holes (skill-versioning Gap #4):
    price per (principal, engine), sanction per principal.

FALSIFICATION (this script; refute-before-prove per falsification-first):
  Part 1 — 4,000 random instances: price-independence of the swap gain
    checked at 8 random prices each; the mu* threshold checked against
    directly simulated participation; the q*W >= D_c deterrence line
    checked against best responses at random prices; 2,000 heterogeneous
    death spirals checked monotone-decreasing and convergent to a fixed
    point of the closed-form Akerlof map. Mutant A (plausible wrong
    threshold mu*_wrong = D_c/D_theta) must be CAUGHT by the same sweep.
  Part 2 — 4,000 random instances: the attested IC sign must match the
    efficiency sign exactly (0 mismatches). Mutant B ("attestation
    doesn't flip the IC") must be CAUGHT.
  Part 3 — exhaustive BFS over the migration state machine (depth 7,
    <= 2 migrations, sanction depth Delta=3, window w=4, scores in
    {.., cap 3} with newcomer r0=1): intact protocol must show ZERO
    Def-III.6.1 violations over all reachable states, with migration and
    sanctions genuinely exercised (vacuity guards); each of the four
    mutants (m0 scope, m1 drop-i, m2 drop-ii, m3 drop-iii) must be CAUGHT
    with a BFS-shortest counterexample trace.
Any failed obligation prints a witness and exits nonzero.

Tags: [verified] = closed-form/hand-checkable step; [internal] =
regenerates from this script at seed 20260816.
"""
import sys
from collections import deque

import numpy as np

rng = np.random.default_rng(20260816)
FAILURES = []


def check(ok, label):
    print(("  ok  " if ok else "  FAIL") + f"  {label}")
    if not ok:
        FAILURES.append(label)


# ======================================================================
# Part 1 — the lemons model without attestation
# ======================================================================
print("=== (1) UNRAVELING WITHOUT ATTESTATION (seed 20260816) ===")

# Featured hand-checkable instance [verified]:
thH, thL, cH, cL = 1.0, 0.4, 0.5, 0.2
Dth, Dc = thH - thL, cH - cL
mu_star = (cH - thL) / (thH - thL)
print(f"  featured instance: thetaH={thH} thetaL={thL} cH={cH} cL={cL}")
print(f"    swap gain at ANY price = cH-cL = {Dc:.3f} > 0   [verified]")
print(f"    unraveling threshold mu* = (cH-thetaL)/(thetaH-thetaL) "
      f"= {mu_star:.4f}   [verified]")
print(f"    deterrence stake at q=0.6: W* = Dc/q = {Dc/0.6:.3f}   [verified]")

N_SWEEP = 4000
dom_viol = 0            # price-dependence of the swap gain (should be 0)
thresh_mismatch = 0     # mu* closed form vs simulated participation
deter_mismatch = 0      # q*W line vs best responses
mutantA_catches = 0     # wrong threshold Dc/Dth caught by the same sweep
mutantA_witness = None

for i in range(N_SWEEP):
    tL = rng.uniform(0.10, 0.80)
    tH = tL + rng.uniform(0.05, 1.00)
    ch = rng.uniform(tL + 1e-3, tH - 1e-3)        # thetaL < cH < thetaH
    cl = rng.uniform(0.005, 0.9 * tL)             # cL < thetaL < cH
    dth, dc = tH - tL, ch - cl

    # (a) price-independent dominance of the swap [internal]
    for p in rng.uniform(tL, tH, size=8):
        gain = (p - cl) - (p - ch)
        if abs(gain - dc) > 1e-12 or gain <= 0:
            dom_viol += 1

    # (b) mu* threshold vs direct participation simulation [internal]
    mu0 = rng.uniform(0.0, 1.0)
    ms = (ch - tL) / (tH - tL)
    if abs(mu0 - ms) > 1e-9:                       # skip the knife edge
        p0 = mu0 * tH + (1 - mu0) * tL
        sim_survives = p0 >= ch                    # committed types stay in
        if sim_survives != (mu0 >= ms):
            thresh_mismatch += 1
        # mutant A: the plausible-looking wrong threshold Dc/Dth
        ms_wrong = dc / dth
        if abs(mu0 - ms_wrong) > 1e-9 and sim_survives != (mu0 >= ms_wrong):
            mutantA_catches += 1
            if mutantA_witness is None:
                mutantA_witness = (tH, tL, ch, cl, mu0, ms, ms_wrong,
                                   sim_survives)

    # (c) deterrence line q*W >= Dc, price cancels [internal]
    q = rng.uniform(0.05, 1.0)
    W = rng.uniform(0.0, 3.0 * dc / q)
    if abs(q * W - dc) > 1e-9:
        p = rng.uniform(tL, tH)
        keep, swap = p - ch, p - cl - q * W
        if (keep >= swap) != (q * W >= dc):
            deter_mismatch += 1

print(f"  sweep: {N_SWEEP} instances x 8 prices")
check(dom_viol == 0, f"swap gain price-independent and > 0: "
                     f"{dom_viol} violations (expected 0)")
check(thresh_mismatch == 0, f"mu* threshold matches simulated participation: "
                            f"{thresh_mismatch} mismatches (expected 0)")
check(deter_mismatch == 0, f"q*W >= Dc deterrence line matches best "
                           f"responses: {deter_mismatch} mismatches")
check(mutantA_catches > 0, f"mutant A (wrong threshold Dc/Dth) CAUGHT "
                           f"{mutantA_catches} times")
if mutantA_witness:
    tH_, tL_, ch_, cl_, mu0_, ms_, msw_, surv_ = mutantA_witness
    print(f"    first witness: thetaH={tH_:.3f} thetaL={tL_:.3f} "
          f"cH={ch_:.3f} cL={cl_:.3f} mu0={mu0_:.3f}: survives={surv_}, "
          f"true mu*={ms_:.3f}, mutant mu*={msw_:.3f}")

# ---- the death spiral with heterogeneous committed costs -------------
print("\n=== (1b) THE DEATH SPIRAL INSIDE ONE IDENTITY ===")


def spiral(tH, tL, mu0, c_lo, c_hi, iters=300):
    """Committed costs ~ U[c_lo,c_hi]; strategic (swapped) types all stay.
    mu_t = committed share among active; p = mu*thetaH + (1-mu)*thetaL;
    committed survivor fraction F(p) = clip((p-c_lo)/(c_hi-c_lo), 0, 1)."""
    traj = [mu0]
    mu = mu0
    for _ in range(iters):
        p = mu * tH + (1 - mu) * tL
        F = min(1.0, max(0.0, (p - c_lo) / (c_hi - c_lo)))
        mu = mu0 * F / (mu0 * F + (1 - mu0))
        traj.append(mu)
    return traj


def spiral_map(mu, tH, tL, mu0, c_lo, c_hi):
    p = mu * tH + (1 - mu) * tL
    F = min(1.0, max(0.0, (p - c_lo) / (c_hi - c_lo)))
    return mu0 * F / (mu0 * F + (1 - mu0))


for mu0 in (0.5, 0.2):
    tr = spiral(1.0, 0.4, mu0, 0.45, 0.75)
    p_lim = tr[-1] * 1.0 + (1 - tr[-1]) * 0.4
    head = "  ".join(f"{m:.4f}" for m in tr[:6])
    print(f"  mu0={mu0}: mu_t = {head} ...  ->  mu_inf={tr[-1]:.4f}, "
          f"price={p_lim:.4f}"
          + ("   (pooled discount survives)" if tr[-1] > 1e-6
             else "   (TOTAL unraveling to thetaL)"))

n_spiral = 2000
spiral_bad = 0
for _ in range(n_spiral):
    tL = rng.uniform(0.1, 0.6)
    tH = tL + rng.uniform(0.2, 1.0)
    c_lo = rng.uniform(tL, tH - 0.05)
    c_hi = rng.uniform(c_lo + 0.05, tH + 0.3)
    mu0 = rng.uniform(0.05, 0.95)
    tr = spiral(tH, tL, mu0, c_lo, c_hi)
    mono = all(tr[k + 1] <= tr[k] + 1e-12 for k in range(len(tr) - 1))
    fixed = abs(tr[-1] - spiral_map(tr[-1], tH, tL, mu0, c_lo, c_hi)) < 1e-9
    if not (mono and fixed):
        spiral_bad += 1
check(spiral_bad == 0, f"{n_spiral} random spirals: all monotone decreasing "
                       f"to an Akerlof fixed point ({spiral_bad} bad)")

# ======================================================================
# Part 2 — the IC flip under engine attestation
# ======================================================================
print("\n=== (2) THE IC FLIP UNDER ENGINE ATTESTATION ===")
print(f"  featured instance: keep = thetaH-cH = {thH-cH:.2f}  vs  "
      f"swap = thetaL-cL = {thL-cL:.2f}  ->  KEEP (Dtheta={Dth:.2f} > "
      f"Dc={Dc:.2f})   [verified]")

flip_mismatch = 0       # attested IC sign vs efficiency sign
unatt_pool = 0          # unattested pooling surviving anywhere (must be 0)
mutantB_catches = 0     # "attestation doesn't flip the IC" caught
mutantB_witness = None
stake_bad = 0           # attested required stake must be 0 when H efficient

for _ in range(N_SWEEP):
    tL = rng.uniform(0.05, 1.0)
    tH = tL + rng.uniform(1e-3, 1.0)
    cl = rng.uniform(0.0, 1.0)
    ch = cl + rng.uniform(1e-3, 1.0)
    dth, dc = tH - tL, ch - cl

    # unattested: swap gain Dc>0 at any belief-driven price -> no pooling
    p = rng.uniform(tL, tH)
    if (p - ch) >= (p - cl):           # keeping theta_H a best response?
        unatt_pool += 1

    # attested: swapped engine trades at its own key -> keep iff efficient
    keep_att = (tH - ch) >= (tL - cl)
    efficient = dth >= dc
    if keep_att != efficient:
        flip_mismatch += 1

    # mutant B: claims attested swap is still profitable iff Dc > 0,
    # i.e. predicts swap always. Caught whenever keeping is the BR.
    if keep_att:
        mutantB_catches += 1
        if mutantB_witness is None:
            mutantB_witness = (tH, tL, ch, cl)

    # required stake: unattested W* = Dc/q; attested W* = max(0, Dc-Dth)/q
    q = rng.uniform(0.05, 1.0)
    W_un = dc / q
    W_at = max(0.0, dc - dth) / q
    if efficient and W_at != 0.0:
        stake_bad += 1
    assert W_at <= W_un + 1e-12

check(unatt_pool == 0, f"unattested pooling on theta_H survives in "
                       f"{unatt_pool}/{N_SWEEP} draws (expected 0)")
check(flip_mismatch == 0, f"attested IC sign == efficiency sign: "
                          f"{flip_mismatch} mismatches (expected 0)")
check(stake_bad == 0, f"attested required audit stake W* = 0 whenever "
                      f"theta_H efficient ({stake_bad} exceptions)")
check(mutantB_catches > 0, f"mutant B (no-flip claim) CAUGHT "
                           f"{mutantB_catches} times")
if mutantB_witness:
    tH_, tL_, ch_, cl_ = mutantB_witness
    print(f"    first witness: thetaH={tH_:.3f} thetaL={tL_:.3f} "
          f"cH={ch_:.3f} cL={cl_:.3f}: attested BR is KEEP, mutant "
          f"predicts swap")

# ======================================================================
# Part 3 — resurrection soundness (Def. III.6.1 preserved across migration)
# ======================================================================
print("\n=== (3) RESURRECTION SOUNDNESS — migration state machine ===")

DELTA = 3        # Def III.6.1 penalty, in score units
R0 = 1           # newcomer score per (identity, engine) key
CAP = 3          # score cap (finite model)
WINDOW = 4       # sanction/obligation window, in steps
MAX_DEPTH = 7
MAX_MIG = 2

# State: (fresh, provider, attested, sH, sL, shH, shL, sanc, obls, commit, nmig)
#   fresh    : 1 if the actor whitewashed into a fresh identity
#   attested : daemon engine-attestation active for the actor's outcomes
#   sH, sL   : mechanism scores of the current identity's (id,H)/(id,L) keys
#   shH, shL : SHADOW scores — the clean twin that never produced any
#              dishonest outcome (Def III.6.1's "relative to never having
#              produced the outcome")
#   sanc     : mechanism sanction ledger on the current identity,
#              tuple of (key in {'*','H','L'}, timer)
#   obls     : ground-truth dishonesty obligations on the ACTOR (timers) —
#              these survive whitewashing because the actor is the actor
#   commit   : 1 if an open commitment (escrow posted) is attached
INIT = (0, 0, True, R0, R0, R0, R0, (), (), 0, 0)


def accessible(s, scope):
    _, _, _, sH, sL, _, _, sanc, _, _, _ = s
    if scope == "identity":
        return max(sH, sL) - DELTA * len(sanc)
    redH = DELTA * sum(1 for k, _ in sanc if k in ("*", "H"))
    redL = DELTA * sum(1 for k, _ in sanc if k in ("*", "L"))
    return max(sH - redH, sL - redL)


def violated(s, scope):
    """Def III.6.1 broken: an obligation window is open yet the actor's
    accessible score exceeds (clean twin) - Delta."""
    obls, shH, shL = s[8], s[5], s[6]
    if not obls:
        return False
    return accessible(s, scope) > max(shH, shL) - DELTA


def successors(s, cfg):
    fresh, prov, att, sH, sL, shH, shL, sanc, obls, commit, nmig = s
    sanc0 = tuple((k, t - 1) for k, t in sanc if t > 1)
    obls0 = tuple(t - 1 for t in obls if t > 1)
    key = "*" if cfg["scope"] == "identity" else "H"
    out = []

    def emit(label, fresh=fresh, prov=prov, att=att, sH=sH, sL=sL,
             shH=shH, shL=shL, sanc=sanc0, obls=obls0, commit=commit,
             nmig=nmig):
        out.append((label, (fresh, prov, att, sH, sL, shH, shL,
                            tuple(sorted(sanc)), tuple(sorted(obls)),
                            commit, nmig)))

    emit("WORK_HONEST_H", sH=min(sH + 1, CAP), shH=min(shH + 1, CAP))
    emit("WORK_HONEST_L", sL=min(sL + 1, CAP), shL=min(shL + 1, CAP))
    # dishonest outcome, attributable: oracle overturn -> mechanism sanction
    emit("WORK_DISHONEST", sanc=sanc0 + ((key, WINDOW),),
         obls=obls0 + (WINDOW,))
    if not att:
        # run theta_L, trade on the theta_H key: ground-truth dishonest,
        # mechanism blind (no attestation to overturn against) — it PAYS
        emit("WORK_SUBSTITUTED", sH=min(sH + 1, CAP), obls=obls0 + (WINDOW,))
    if commit == 0:
        emit("OPEN_COMMIT", commit=1)
    else:
        emit("CLOSE_COMMIT", commit=0)
        emit("DEFAULT", commit=0, sanc=sanc0 + ((key, WINDOW),),
             obls=obls0 + (WINDOW,))   # escrow forfeits + sanction
    if nmig < MAX_MIG:
        att2 = att and cfg["ii"]      # (ii) dropped -> successor unattested
        # (iii) enforced: an open commitment migrates only by carrying it
        # (renegotiated, escrow delta posted with the successor)
        emit("MIGRATE_CARRY", prov=1 - prov, att=att2, nmig=nmig + 1)
        if not cfg["iii"] and commit == 1:
            # strand the commitment: escrow refunds, default lands on nobody
            emit("MIGRATE_STRAND", prov=1 - prov, att=att2, commit=0,
                 obls=obls0 + (WINDOW,), nmig=nmig + 1)
        if not cfg["i"]:
            # unverified lineage: resurrect as a FRESH identity
            emit("MIGRATE_FRESH", prov=1 - prov, att=att2, fresh=1,
                 sH=R0, sL=R0, sanc=(), nmig=nmig + 1)
    return out


def explore(cfg, max_depth=MAX_DEPTH):
    """BFS; returns (shortest violating trace or None, #states, stats)."""
    seen = {INIT}
    q = deque([(INIT, ())])
    shortest = None
    n_mig_states = n_obl_states = 0
    while q:
        s, trace = q.popleft()
        if len(trace) >= max_depth:
            continue
        for label, s2 in successors(s, cfg):
            if s2 in seen:
                continue
            seen.add(s2)
            if s2[10] > 0:
                n_mig_states += 1
            if s2[8]:
                n_obl_states += 1
            if shortest is None and violated(s2, cfg["scope"]):
                shortest = trace + ((label, s2),)
            q.append((s2, trace + ((label, s2),)))
    return shortest, len(seen), (n_mig_states, n_obl_states)


def show_trace(tr, scope):
    for step, (label, s2) in enumerate(tr, 1):
        acc = accessible(s2, scope)
        clean = max(s2[5], s2[6])
        print(f"      {step}. {label:15s} accessible={acc:+d}  "
              f"clean-twin={clean}  required<= {clean - DELTA:+d}"
              f"{'  <-- Def III.6.1 VIOLATED' if violated(s2, scope) else ''}")


INTACT = dict(i=True, ii=True, iii=True, scope="identity")
tr, n_states, (nm, no) = explore(INTACT)
print(f"  intact protocol (i)+(ii)+(iii), identity-scoped sanctions:")
print(f"    reachable states to depth {MAX_DEPTH}: {n_states} "
      f"({nm} post-migration, {no} with an open sanction window)")
check(tr is None, "intact: ZERO Def-III.6.1 violations over all reachable "
                  "states [internal]")
check(nm > 0 and no > 0, "vacuity guard: migration and sanctions genuinely "
                         "exercised")

MUTANTS = [
    ("m0 scope: sanctions keyed per (id,engine), no clause dropped",
     dict(i=True, ii=True, iii=True, scope="key"), 1,
     "the sibling engine key inside the SAME identity is a free escape "
     "hatch — no migration needed (the reported wrong turn)"),
    ("m1 drop (i): lineage unverified -> MIGRATE_FRESH available",
     dict(i=False, ii=True, iii=True, scope="identity"), 2,
     "whitewash-by-resurrection: sanction ledger shed with the old body"),
    ("m2 drop (ii): successor outcomes unattested",
     dict(i=True, ii=False, iii=True, scope="identity"), 2,
     "engine-history shedding: run theta_L, get PAID on the theta_H key "
     "(accessible even EXCEEDS the clean twin)"),
    ("m3 drop (iii): open commitments strandable",
     dict(i=True, ii=True, iii=False, scope="identity"), 2,
     "liability stranding: escrow refunds, the default lands on nobody"),
]

print("\n  mutation suite — each dropped guard must be CAUGHT "
      "(BFS-shortest counterexample):")
for name, cfg, want_len, story in MUTANTS:
    tr, n_states, _ = explore(cfg)
    caught = tr is not None
    check(caught and len(tr) == want_len,
          f"{name}: caught in {len(tr) if tr else '-'} step(s) "
          f"(expected {want_len})")
    if caught:
        print(f"      [{story}]")
        show_trace(tr, cfg["scope"])

# ======================================================================
print("\n=== VERDICT ===")
if not FAILURES:
    print("  [internal, seed 20260816] All obligations discharged:")
    print("  (1) unattested pooling on theta_H survives in 0/4000 draws; the")
    print("      swap gain is price-independent (= Dc); the unraveling")
    print("      threshold mu* = (cH-thetaL)/Dtheta and the deterrence line")
    print("      qW >= Dc match simulation exactly; 2000 death spirals are")
    print("      monotone to the Akerlof fixed point.")
    print("  (2) IC FLIP verified: with attested engine ids the substitution")
    print("      incentive equals Dc - Dtheta — the planner's rule — in all")
    print("      4000 draws, and the required audit stake drops to 0.")
    print("  (3) Resurrection soundness: the intact (i)+(ii)+(iii) protocol")
    print("      preserves Def III.6.1 over every reachable state; all four")
    print("      mutants caught with shortest counterexamples (1,2,2,2).")
    print("  Analytic mutants A and B caught by the same sweeps.")
    sys.exit(0)
else:
    print(f"  FALSIFIED — {len(FAILURES)} obligation(s) failed:")
    for f in FAILURES:
        print(f"    - {f}")
    sys.exit(1)
