#!/usr/bin/env python3
"""
B2 — The Inspection Tower: who audits the auditors, and what it costs
=====================================================================
Three parts, each derived then verified:
 (1) STAGE GAME. Judge may cheat for one-shot gain G; auditor audits w.p. rho at
     cost a, detects w.p. d, slashes bond B. Deterrence (keep-gain convention):
     cheat payoff = G - rho*d*B  =>  rho* = G/(dB)   (Becker's condition).
     Confiscation convention (caught => also lose G): rho*_c = G/(d(G+B)) < rho*.
     Classical mixed NE of the simultaneous game: judge indifference gives
     rho* = G/(dB); auditor indifference gives q* = a/(dL) (L = auditor's loss
     from an uncaught cheat). Verified by direct best-response check.
 (2) TOWER CONTRACTION. Level k+1 audits level-k auditors, sampled sealed from a
     pool spanning C disjoint cliques (distinct principals / model families).
     A briber protecting corrupt value G_k must bribe cliques at price
     beta = rho*d*B each (an auditor's expected forfeiture for accepting);
     bribing c of C cliques succeeds w.p. c/C. Rational bribery is all-or-nothing:
     profitable iff G_k * rho*d > C*beta, i.e. iff G_k > C*B. Once G_k <= C*B,
     bribery stops and corrupt value decays geometrically: G_{k+1} = G_k(1-rho*d).
     => finite bond capital certifies the tower; heterogeneity (large C) is what
     shuts bribery off early. Simulated across C.
 (3) AMORTIZATION. As a judge accumulates verified history, reputation-at-stake
     v*t grows. Two honest models:
       A (loss only if audited):  rho_t = G/(d(B+v t))    => spend Theta(log T)
       B (cheats also surface later w.p. r/period, indep. of audit):
          rho_t = max(0,(G - r v t)/(dB)) hits 0 at t*=G/(rv) => spend O(1),
          closed form a*G^2/(2 d B r v).
     vs flat auditing spend Theta(T). IC verified pointwise: deviation value <= 0
     at every t under each schedule.
"""
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------- (1) stage game ----------
G, d, B, a, L = 10.0, 0.8, 50.0, 1.0, 40.0
rho_star   = G/(d*B)                 # keep-gain deterrence
rho_star_c = G/(d*(G+B))             # confiscation deterrence
q_star     = a/(d*L)                 # auditor-indifference cheat rate (mixed NE)

def judge_cheat_payoff(rho, confiscate=False):
    return G - rho*d*(G+B) if confiscate else G - rho*d*B

# verify mixed NE by indifference (both players indifferent => NE of the matrix game)
u_cheat_at_rho_star = judge_cheat_payoff(rho_star)          # should be ~0 (= honest payoff)
u_audit  = -a - q_star*L*(1-d)                              # auditor: audit
u_noaud  = -q_star*L                                        # auditor: don't
print("=== (1) STAGE GAME ===")
print(f"  rho* (keep-gain)     = G/(dB)      = {rho_star:.4f}")
print(f"  rho* (confiscation)  = G/(d(G+B))  = {rho_star_c:.4f}  (cheaper, as expected)")
print(f"  q*   (mixed NE)      = a/(dL)      = {q_star:.4f}")
print(f"  judge indifferent at rho*: cheat payoff = {u_cheat_at_rho_star:+.6f}  (≈0 ✓)")
print(f"  auditor indifferent at q*: {u_audit:.4f} vs {u_noaud:.4f}  (equal ✓)")
print(f"  committed-deterrence audit spend per judged outcome = a*rho* = {a*rho_star:.4f}")

# ---------- (2) tower contraction ----------
def tower(G0, C, rho, d, B, levels=8):
    """Corrupt value surviving each level with a rational budget-limited briber."""
    beta = rho*d*B                    # min bribe an auditor accepts
    Gk, out = G0, [G0]
    for k in range(levels):
        # bribery profitable iff protecting Gk at full audit-bite beats not bribing:
        #   bribe all C: keep Gk, pay C*beta   vs   no bribe: keep Gk(1-rho*d)
        if Gk*rho*d > C*beta and Gk > C*beta:      # profitable AND affordable
            Gk = Gk - C*beta                        # value net of bribes (survives audit)
        else:
            Gk = Gk*(1 - rho*d)                     # honest audit bites geometrically
        out.append(max(Gk, 0.0))
    return out

print("\n=== (2) TOWER: corrupt value by level, rho=rho*, varying clique count C ===")
G0 = 400.0
curves = {}
for C in [1, 2, 4, 8]:
    curves[C] = tower(G0, C, rho_star, d, B)
    print(f"  C={C}: " + "  ".join(f"{v:7.1f}" for v in curves[C]))
print(f"  reading: with C=1 (homogeneous judges) bribery persists while G_k > C*B={B:.0f};")
print(f"  with C=8, bribery is uneconomical from level 1 and decay is geometric (1-rho*d)={1-rho_star*d:.2f}/level.")
lam = 1 - rho_star*d
lvl_needed = int(np.ceil(np.log(1.0/G0)/np.log(lam)))
print(f"  levels to drive corrupt value below 1 unit (geometric regime): {lvl_needed};")
print(f"  total bond capital = B per level * levels = {B*lvl_needed:.0f}  (FINITE certifies the tower)")

# ---------- (3) amortization ----------
T = 200
v, r = 0.6, 0.05
t = np.arange(T)
rho_flat = np.full(T, rho_star)
rho_A = G/(d*(B + v*t))                             # loss-if-audited model
rho_B = np.maximum(0.0, (G - r*v*t)/(d*B))          # delayed-revelation model
spend = lambda rho: a*np.cumsum(rho)
sf, sA, sB = spend(rho_flat), spend(rho_A), spend(rho_B)
tstar = G/(r*v)
closedB = a*G**2/(2*d*B*r*v)
print("\n=== (3) AMORTIZATION: cumulative audit spend at T =", T, "===")
print(f"  flat:    {sf[-1]:8.2f}   (Theta(T))")
print(f"  model A: {sA[-1]:8.2f}   (Theta(log T);  a*G/(d v)*ln(1+vT/B) = {a*G/(d*v)*np.log(1+v*T/B):.2f})")
print(f"  model B: {sB[-1]:8.2f}   (O(1); closed form aG^2/(2dBrv) = {closedB:.2f}; hits 0 at t*={tstar:.0f})")
# IC verification: deviation value <= 0 at every t under each schedule
devA = G - rho_A*d*(B + v*t)                        # model A: caught => lose bond AND stake
devB = G - (rho_B*d*B + r*v*t)                      # model B: audit slash + delayed loss
print(f"  IC check A: max deviation value = {devA.max():+.2e} (<=0 ✓)")
print(f"  IC check B: max deviation value = {devB.max():+.2e} (<=0 ✓)")

# ---------- figure ----------
fig, ax = plt.subplots(1, 3, figsize=(16.5, 4.6))
rr = np.linspace(0, 0.5, 200)
ax[0].plot(rr, [judge_cheat_payoff(x) for x in rr], color='#1e466e', lw=2, label='cheat payoff, keep-gain')
ax[0].plot(rr, [judge_cheat_payoff(x, True) for x in rr], color='#1f6e46', lw=2, ls='--', label='cheat payoff, confiscation')
ax[0].axhline(0, color='k', lw=0.8); 
ax[0].axvline(rho_star, color='#1e466e', ls=':', lw=1.2); ax[0].axvline(rho_star_c, color='#1f6e46', ls=':', lw=1.2)
ax[0].text(rho_star+.006, 6, f'$\\rho^*$={rho_star:.3f}', color='#1e466e', fontsize=9, rotation=90)
ax[0].text(rho_star_c+.006, 6, f'$\\rho^*_c$={rho_star_c:.3f}', color='#1f6e46', fontsize=9, rotation=90)
ax[0].set_xlabel('audit probability $\\rho$'); ax[0].set_ylabel('judge cheat payoff')
ax[0].set_title('Panel A — the deterrence line\ncheating stops paying at $\\rho^*=G/(dB)$', fontsize=11)
ax[0].legend(fontsize=8.5); ax[0].grid(alpha=.25)

for C, c in zip([1,2,4,8], ['#8c1e1e','#c78a1e','#1e466e','#1f6e46']):
    ax[1].plot(range(len(curves[C])), curves[C], 'o-', color=c, ms=4, lw=1.5, label=f'C={C} cliques')
ax[1].set_yscale('log'); ax[1].set_xlabel('audit level $k$'); ax[1].set_ylabel('surviving corrupt value $G_k$ (log)')
ax[1].set_title('Panel B — the tower contracts\nheterogeneity (C) shuts bribery off early', fontsize=11)
ax[1].legend(fontsize=9); ax[1].grid(alpha=.25, which='both')

ax[2].plot(t, sf, color='#8c1e1e', lw=2, label='flat $\\rho^*$: $\\Theta(T)$')
ax[2].plot(t, sA, color='#1e466e', lw=2, label='model A: $\\Theta(\\log T)$')
ax[2].plot(t, sB, color='#1f6e46', lw=2, label='model B: $O(1)$')
ax[2].axhline(closedB, color='#1f6e46', ls=':', lw=1)
ax[2].set_xlabel('verified-history length $t$'); ax[2].set_ylabel('cumulative audit spend')
ax[2].set_title('Panel C — reputation is amortized verification\naudit spend vs history under IC-safe schedules', fontsize=11)
ax[2].legend(fontsize=9); ax[2].grid(alpha=.25)
plt.tight_layout(); plt.savefig('/home/claude/b2_figure.png', dpi=150, bbox_inches='tight')
print("\nFigure saved to b2_figure.png")
