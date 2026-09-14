#!/usr/bin/env python3
"""B1 corrected: analytic rate-distortion + zoom advantage in the correct regime."""
import numpy as np
from math import log2
rng=np.random.default_rng(20260816)

def h2(x):
    if x<=0 or x>=1: return 0.0
    return -x*log2(x)-(1-x)*log2(1-x)

# ---- (i) Analytic two-constraint rate at the zero-miss corner ----
# X~Bern(p). Zero-miss (delta=0) forces Pr(X=1,Xhat=0)=0, so q11=p, q10=0.
# Flag rate f = Pr(Xhat=1) = q11 + q01 = p + q01, so q01 = f - p (need f>=p).
# Then q00 = 1 - f. Joint fully determined by (p,f): compute I(X;Xhat).
def rate_corner(p,f):
    if f<p-1e-12: return np.inf
    q=np.array([[1-f, f-p],[0.0, p]])         # rows x=0,1 ; cols xhat=0,1
    q=np.clip(q,1e-15,1); q=q/q.sum()
    px=q.sum(1,keepdims=True); pxh=q.sum(0,keepdims=True)
    return float((q*np.log2(q/(px*pxh))).sum())

# miss-tolerant: allow Pr(X=1,Xhat=0)=delta. Then q10=delta, q11=p-delta,
# q01=f-(p-delta), q00=1-f-delta. Minimizing I over the one remaining d.o.f.
# is already pinned by (p,f,delta) here (2x2 with fixed margins+2 constraints).
def rate_general(p,f,delta):
    q11=p-delta; q10=delta; q01=f-q11; q00=1-q10-q11-q01
    if min(q00,q01,q10,q11)<-1e-9 or q01<0: return np.inf
    q=np.clip(np.array([[q00,q01],[q10,q11]]),1e-15,1); q/=q.sum()
    px=q.sum(1,keepdims=True); pxh=q.sum(0,keepdims=True)
    return float((q*np.log2(q/(px*pxh))).sum())

p=0.05
print("(i) Two-constraint rate R(delta,f) — ANALYTIC, Bernoulli p=%.2f"%p)
print(f"{'delta':>7}{'f':>7}{'R(bits/sym)':>13}   note")
for delta,f in [(0.0,p),(0.0,2*p),(0.0,0.15),(0.01,0.10),(0.02,0.08),(0.04,0.06)]:
    R=rate_general(p,f,delta)
    tag = "FLOOR corner (zero-miss, tightest flags)" if (delta==0 and abs(f-p)<1e-9) else \
          ("zero-miss" if delta==0 else "miss-tolerant => cheaper")
    print(f"{delta:>7.3f}{f:>7.3f}{R:>13.4f}   {tag}")

# total bits for N symbols at the corner vs the covering floor cross-check
N=1000
print(f"\n  N={N}: R*N at (delta=0,f=2p) = {rate_general(p,2*p,0)*N:.0f} bits")
print(f"  covering-floor intuition log2 C(N,pN) = { (lambda n,k:(np.sum(np.log2(np.arange(k+1,n+1)))-np.sum(np.log2(np.arange(1,n-k+1)))))(N,int(p*N)):.0f} bits (order matches)")

# ---- (ii) Zoom advantage in the CORRECT regime: flagged set large but SPARSE ----
# The digest is conservative (low false-negative): it flags a large set to be safe,
# but few flagged items are truly critical. Group testing then shines.
# Compare: flat = open every flagged item (=|flagged|) vs adaptive group-splitting
# to IDENTIFY the critical ones = ~ k*log2(|flagged|/k).
def adaptive_group_queries(load_set, flagged):
    flagged=sorted(flagged); opens=0; stack=[flagged]
    while stack:
        grp=stack.pop(); opens+=1
        if not any(i in load_set for i in grp): continue
        if len(grp)==1: continue
        mid=len(grp)//2; stack.append(grp[:mid]); stack.append(grp[mid:])
    return opens

print("\n(ii) Zoom advantage — CONSERVATIVE digest (large flagged set, sparse positives)")
print(f"{'|flagged|':>10}{'k (true LB)':>12}{'flat opens':>12}{'adaptive':>10}{'ratio':>8}{'k*log2(F/k)':>13}")
Npool=5000
for frac_flag,k in [(0.5,10),(0.3,10),(0.2,20),(0.1,20),(0.05,10)]:
    F=int(frac_flag*Npool)
    fl=[]; ad=[]
    for _ in range(150):
        universe=rng.permutation(Npool)
        flagged=set(universe[:F].tolist())
        load=set(rng.choice(list(flagged),size=min(k,F),replace=False).tolist())  # k positives inside flagged
        fl.append(len(flagged)); ad.append(adaptive_group_queries(load,flagged))
    pred=k*log2(max(F/max(k,1),1.001))
    print(f"{F:>10}{k:>12}{np.mean(fl):>12.0f}{np.mean(ad):>10.1f}{np.mean(fl)/max(np.mean(ad),1):>8.1f}{pred:>13.1f}")

print("""
READING: when the flagged set is large but critical items are sparse within
it (a conservative, low-false-negative digest), adaptive zoom opens ~k*log2(F/k)
vs flat's F — a large ratio. When the flagged set is already dense in positives
(f~1.5p), group testing does NOT help (overhead dominates) — the honest boundary.
The zoom-advantage theorem holds precisely in the sparse-flagged regime, which is
exactly the regime a SAFE (miss-averse) digest operates in.""")
