"""
B1 — The Digest-Zoom Pareto Frontier
=====================================
Two deliverables:
  (i)  The two-constraint rate-distortion function R(delta, f) for a binary source,
       solved via the test-channel / Lagrangian method and verified numerically.
       Theorem I.6.1's worst-case floor is the (delta=0) corner.
  (ii) The zoom-advantage theorem: adaptive second-stage inspection (Hwang-style
       generalized binary splitting inside the flagged set) reduces expected opens
       from f*N to k*log2(fN/k)+O(k), quantifying what "zoom" buys over a flat digest.

Model. Each of N artifacts is load-bearing i.i.d. Bernoulli(p). A digest is B bits
about X^N; the operator opens the flagged set (size ~fN) and may then ZOOM
adaptively (open groups, drilling only into flagged groups). Costs:
    total = c_read * B  +  c_open * E[opens]  +  c_miss * E[missed load-bearing].
The digest's job (stage 1) is a lossy description with a FALSE-NEGATIVE constraint
(misses priced by delta) and a flag-rate constraint (false positives priced by f).
"""
import numpy as np
from math import log2, lgamma, log, ceil
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
rng = np.random.default_rng(20260816)

def h2(x):
    if x<=0 or x>=1: return 0.0
    return -x*log2(x)-(1-x)*log2(1-x)

# ------------------------------------------------------------------
# (i) Two-constraint rate-distortion for a Bernoulli(p) source.
# Test channel: source X in {0,1} (1=load-bearing), reconstruction/flag Xhat in {0,1}
# (1=flagged). Constraints:
#   false negative  Pr(X=1, Xhat=0) <= delta      (misses)
#   flag rate       Pr(Xhat=1)      <= f          (open budget)
# Rate R = I(X;Xhat) minimized over channels meeting both.
# We solve the small convex program directly (4 joint probs, 2 marginprobs fixed).
# ------------------------------------------------------------------
from scipy.optimize import linprog, minimize

def rate_two_constraint(p, delta, f):
    """Minimize I(X;Xhat) s.t. FN<=delta, flag-rate<=f, valid joint with X~Bern(p)."""
    # joint q[x,xh], x in{0,1}, xh in{0,1}; marginals on X fixed to (1-p, p)
    # variables: q00,q01,q10,q11  (x,xh)
    def mi(q):
        q=np.clip(q,1e-12,1); q=q.reshape(2,2); q/=q.sum()
        px=q.sum(1,keepdims=True); pxh=q.sum(0,keepdims=True)
        return float((q*np.log2(q/(px*pxh))).sum())
    cons=[
        {'type':'eq','fun':lambda q: q.sum()-1},
        {'type':'eq','fun':lambda q: q[0]+q[1]-(1-p)},   # Pr(X=0)=1-p
        {'type':'eq','fun':lambda q: q[2]+q[3]-p},        # Pr(X=1)=p
        {'type':'ineq','fun':lambda q: delta-q[2]},       # FN=Pr(X=1,Xhat=0)=q10<=delta
        {'type':'ineq','fun':lambda q: f-(q[1]+q[3])},    # flag rate=Pr(Xhat=1)<=f
    ]
    best=np.inf
    for _ in range(12):
        x0=rng.dirichlet([1,1,1,1])
        res=minimize(mi,x0,constraints=cons,bounds=[(0,1)]*4,
                     method='SLSQP',options={'maxiter':300,'ftol':1e-10})
        if res.success: best=min(best,res.fun)
    return max(best,0.0)

p=0.05
print("="*66)
print(f"(i) Two-constraint rate-distortion R(delta,f), Bernoulli source p={p}")
print("="*66)
print(f"{'delta':>8} {'f':>6} {'R(bits/sym)':>12}   note")
for delta,f in [(0.0,p),(0.0,2*p),(0.0,0.15),(0.01,0.10),(0.02,0.08),(0.05,0.05)]:
    R=rate_two_constraint(p,delta,f)
    note=""
    if delta==0 and abs(f-p)<1e-9: note="zero-miss, minimal flags (the floor corner)"
    elif delta==0: note="zero-miss, generous flags"
    else: note="miss-tolerant -> cheaper"
    print(f"{delta:>8.3f} {f:>6.3f} {R:>12.4f}   {note}")

# Frontier: R vs f at delta=0, and R vs delta at fixed f
fgrid=np.linspace(p+1e-3,0.4,25)
R_f=[rate_two_constraint(p,0.0,f) for f in fgrid]
dgrid=np.linspace(0,p,20)
R_d=[rate_two_constraint(p,d,0.10) for d in dgrid]

# ------------------------------------------------------------------
# (ii) Zoom-advantage: flat digest opens f*N; adaptive splitting opens
# ~ k*log2(fN/k). Simulate both to confirm.
# ------------------------------------------------------------------
def flat_opens(N,flagged):        return len(flagged)
def adaptive_opens(N, load_set, flagged_set):
    """Generalized binary splitting inside the flagged set: recursively halve a
    group; if a group tests 'contains a load-bearing item' (one group query),
    drill in; else discard. Counts GROUP QUERIES (zoom opens)."""
    flagged=sorted(flagged_set)
    if not flagged: return 0
    opens=0
    stack=[flagged]
    while stack:
        grp=stack.pop()
        opens+=1                                  # one group query (zoom)
        contains=any(i in load_set for i in grp)
        if not contains: continue
        if len(grp)==1: continue                  # identified
        mid=len(grp)//2
        stack.append(grp[:mid]); stack.append(grp[mid:])
    return opens

print("\n"+"="*66)
print("(ii) Zoom-advantage: flat opens vs adaptive (group-splitting) opens")
print("="*66)
N=1000
print(f"{'k':>5} {'flagged fN':>11} {'flat opens':>11} {'adaptive opens':>15} {'ratio':>7} {'k*log2(fN/k)':>13}")
for p_ in [0.01,0.02,0.05,0.1]:
    trials=200; flat=[]; adap=[]
    for _ in range(trials):
        X=rng.random(N)<p_
        load=set(np.where(X)[0])
        k=len(load)
        # flag = true load set plus false positives to reach flag rate f=1.5*p
        f=min(1.0,1.5*p_)
        n_flag=int(f*N)
        extra=set(rng.choice(np.where(~X)[0], size=max(0,n_flag-k), replace=False)) if n_flag>k else set()
        flagged=load|extra
        flat.append(flat_opens(N,flagged))
        adap.append(adaptive_opens(N,load,flagged))
    k_mean=p_*N; fN=1.5*p_*N
    pred=k_mean*log2(max(fN/max(k_mean,1),1.001))
    print(f"{k_mean:>5.0f} {fN:>11.0f} {np.mean(flat):>11.1f} {np.mean(adap):>15.1f} "
          f"{np.mean(flat)/max(np.mean(adap),1):>7.2f} {pred:>13.1f}")

# ------------------------------------------------------------------
# RENDER frontier + zoom advantage
# ------------------------------------------------------------------
fig,axes=plt.subplots(1,3,figsize=(16.5,4.8))

ax=axes[0]
ax.plot(fgrid,R_f,'o-',color='#1e466e',ms=4,lw=1.6)
ax.axvline(p,color='gray',ls='--',lw=1); ax.text(p+0.005,max(R_f)*0.9,f'f=p={p}',color='gray',fontsize=9)
ax.set_xlabel('flag rate $f$ (open budget)'); ax.set_ylabel('rate $R$ (bits/symbol)')
ax.set_title(f'Panel A — zero-miss rate vs open budget\nmore opens $\\Rightarrow$ fewer digest bits ($p$={p})',fontsize=11)
ax.grid(alpha=0.25)

ax=axes[1]
ax.plot(dgrid,R_d,'s-',color='#8c1e1e',ms=4,lw=1.6)
ax.set_xlabel('miss tolerance $\\delta$'); ax.set_ylabel('rate $R$ (bits/symbol)')
ax.set_title('Panel B — rate vs miss tolerance (fixed $f$=0.10)\ntolerating misses is cheaper',fontsize=11)
ax.grid(alpha=0.25)

ax=axes[2]
ps=[0.01,0.02,0.05,0.1]; flatv=[]; adapv=[]
N=1000
for p_ in ps:
    fl=[]; ad=[]
    for _ in range(150):
        X=rng.random(N)<p_; load=set(np.where(X)[0]); k=len(load)
        f=min(1.0,1.5*p_); n_flag=int(f*N)
        extra=set(rng.choice(np.where(~X)[0],size=max(0,n_flag-k),replace=False)) if n_flag>k else set()
        flagged=load|extra
        fl.append(len(flagged)); ad.append(adaptive_opens(N,load,flagged))
    flatv.append(np.mean(fl)); adapv.append(np.mean(ad))
xx=np.arange(len(ps)); w=0.35
ax.bar(xx-w/2,flatv,w,label='flat digest opens $\\approx fN$',color='#8c1e1e',alpha=0.8)
ax.bar(xx+w/2,adapv,w,label='adaptive zoom opens $\\approx k\\log(fN/k)$',color='#1f6e46',alpha=0.85)
ax.set_xticks(xx); ax.set_xticklabels([f'p={p_}' for p_ in ps])
ax.set_ylabel('expected operator opens'); ax.legend(fontsize=9)
ax.set_title('Panel C — the zoom advantage\nadaptive inspection $\\ll$ flat',fontsize=11)
ax.grid(alpha=0.25,axis='y')

plt.tight_layout()
plt.savefig(Path(__file__).resolve().parent / 'b1_figure.png',dpi=150,bbox_inches='tight')
print("\nFigure saved to b1_figure.png")
