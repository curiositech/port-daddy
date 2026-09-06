import numpy as np
from math import log2
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
rng=np.random.default_rng(20260816)

def rate_general(p,f,delta):
    q11=p-delta; q10=delta; q01=f-q11; q00=1-q10-q11-q01
    if min(q00,q01,q10,q11)<-1e-9 or q01<0: return np.nan
    q=np.clip(np.array([[q00,q01],[q10,q11]]),1e-15,1); q/=q.sum()
    px=q.sum(1,keepdims=True); pxh=q.sum(0,keepdims=True)
    return float((q*np.log2(q/(px*pxh))).sum())

def adaptive_group_queries(load_set,flagged):
    flagged=sorted(flagged); opens=0; stack=[flagged]
    while stack:
        grp=stack.pop(); opens+=1
        if not any(i in load_set for i in grp): continue
        if len(grp)==1: continue
        mid=len(grp)//2; stack.append(grp[:mid]); stack.append(grp[mid:])
    return opens

p=0.05
fig,axes=plt.subplots(1,3,figsize=(16.5,4.8))

# Panel A: R vs f (zero-miss) for several p
ax=axes[0]
for pp,c in zip([0.02,0.05,0.1],['#1f6e46','#1e466e','#8c1e1e']):
    fg=np.linspace(pp,0.4,40); R=[rate_general(pp,f,0) for f in fg]
    ax.plot(fg,R,'-',color=c,lw=1.8,label=f'p={pp}')
ax.set_xlabel('flag rate $f$ (open budget)'); ax.set_ylabel('rate $R$ (bits/symbol)')
ax.set_title('Panel A — zero-miss rate vs open budget\nmore opens $\\Rightarrow$ fewer digest bits',fontsize=11)
ax.legend(fontsize=9); ax.grid(alpha=0.25)

# Panel B: R vs delta at fixed f, for several p.
# The pinned closed form is only valid while f0 < 1-delta/p (both constraints
# bind); past that boundary an X-independent flagger already meets the miss
# budget on its own and the true rate is exactly 0. Evaluating the pinned
# formula past the boundary anyway produces a spurious uptick (paper1.tex's
# "geometric honesty note") -- clip the plotted curve at the boundary instead.
ax=axes[1]
for pp,c in zip([0.02,0.05,0.1],['#1f6e46','#1e466e','#8c1e1e']):
    f0=min(0.12,2*pp); dg=np.linspace(0,pp,30)
    d_bound=pp*(1-f0)
    R=[rate_general(pp,f0,d) if d<=d_bound else 0.0 for d in dg]
    ax.plot(dg/pp,R,'-',color=c,lw=1.8,label=f'p={pp}, f={f0:.2f}')
ax.set_xlabel('miss tolerance $\\delta/p$'); ax.set_ylabel('rate $R$ (bits/symbol)')
ax.set_title('Panel B — rate vs miss tolerance\ntolerating misses is cheaper',fontsize=11)
ax.legend(fontsize=8.5); ax.grid(alpha=0.25)

# Panel C: zoom advantage, sparse flagged regime
ax=axes[2]
Npool=5000; configs=[(2500,10),(1500,10),(1000,20),(500,20),(250,10)]
flatv=[]; adapv=[]; labels=[]
for F,k in configs:
    fl=[]; ad=[]
    for _ in range(120):
        universe=rng.permutation(Npool); flagged=set(universe[:F].tolist())
        load=set(rng.choice(list(flagged),size=min(k,F),replace=False).tolist())
        fl.append(len(flagged)); ad.append(adaptive_group_queries(load,flagged))
    flatv.append(np.mean(fl)); adapv.append(np.mean(ad)); labels.append(f'F={F}\nk={k}')
xx=np.arange(len(configs)); w=0.38
ax.bar(xx-w/2,flatv,w,label='flat: open all flagged ($F$)',color='#8c1e1e',alpha=0.8)
ax.bar(xx+w/2,adapv,w,label='adaptive zoom ($\\approx k\\log_2 \\frac{F}{k}$)',color='#1f6e46',alpha=0.85)
ax.set_yscale('log'); ax.set_xticks(xx); ax.set_xticklabels(labels,fontsize=8)
ax.set_ylabel('expected operator opens (log)'); ax.legend(fontsize=8.5,loc='upper right')
ax.set_title('Panel C — the zoom advantage (sparse flagged set)\nadaptive $\\ll$ flat when positives are rare',fontsize=11)
ax.grid(alpha=0.25,axis='y',which='both')

plt.tight_layout(); plt.savefig('b1_figure.png',dpi=150,bbox_inches='tight')
print("B1 figure regenerated.")
