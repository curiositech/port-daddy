#!/usr/bin/env python3
"""
R4 figures: digest-zoom frontier
Two PNG outputs: r4_relation.png and r4_regime.png
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch

# HOUSE RULES
harborblue = (30/255, 70/255, 110/255)
shipred = (140/255, 30/255, 30/255)
seagreen = (31/255, 110/255, 70/255)
dpi = 150
font_size = 10

# Set seed for determinism
np.random.seed(20260816)

# ============================================================================
# Shared closed form (recomputed inline from b1_figure.py's rate_general,
# not imported): I(X;X-hat) for a Bernoulli(p) source under a two-constraint
# joint (miss rate <= delta, flag rate <= f). Verified against the three
# compendium numbers below to machine precision before use here.
# ============================================================================

def rate_general(p, f, delta):
    q11 = p - delta
    q10 = delta
    q01 = f - q11
    q00 = 1 - q10 - q11 - q01
    if min(q00, q01, q10, q11) < -1e-9 or q01 < 0:
        return np.nan
    q = np.clip(np.array([[q00, q01], [q10, q11]]), 1e-15, 1)
    q = q / q.sum()
    px = q.sum(1, keepdims=True)
    pxh = q.sum(0, keepdims=True)
    return float((q * np.log2(q / (px * pxh))).sum())

# ============================================================================
# Figure 1: r4_relation.png — RELATION-MAP
#   Base: the classical single-constraint rate-distortion problem
#   Target: R4's two-constraint operator dial, its entropy boundary, and
#           the search-cost consequence (zoom) that the sparsity clause buys
# ============================================================================

fig, ax = plt.subplots(figsize=(12, 7.8), dpi=dpi)
ax.set_xlim(0, 12)
ax.set_ylim(0, 10.6)
ax.axis('off')

ax.text(6, 10.3, "R4 — the digest-zoom Pareto frontier: two knobs buy back bits, sparsity buys back opens",
        fontsize=12, weight='bold', ha='center', va='top', color=harborblue)

# Base domain (left): classical single-constraint rate-distortion
ax.add_patch(Rectangle((0.2, 0.7), 3.6, 8.7, edgecolor=harborblue,
                        facecolor=harborblue, alpha=0.12, linewidth=1.5))
ax.text(2.0, 9.05, "Base: single-constraint RD", fontsize=11, weight='bold', ha='center', va='center')

# Target domain (right): R4's two-constraint dial
ax.add_patch(Rectangle((8.2, 0.7), 3.6, 8.7, edgecolor=seagreen,
                        facecolor=seagreen, alpha=0.12, linewidth=1.5))
ax.text(10.0, 9.05, "Target: R4's operator dial", fontsize=11, weight='bold', ha='center', va='center')

rows = [
    # (y, base lines, target lines, arrow label lines)
    (7.4,
     ["minimize I(X;X̂)", "s.t. distortion ≤ D", "(Shannon 1959,", "textbook RDC)"],
     ["minimize I(X;X̂)", "s.t. miss rate ≤ δ", "AND flag rate ≤ f", "(custom formulation)"],
     ["a SECOND knob:", "flags buy back bits"]),
    (4.7,
     ["zero tolerance:", "δ = 0,", "no missed", "positives allowed"],
     ["R(0, f→p) = H(p)", "p=0.05 ⇒ 0.286 bits/sym", "[verified, Cover–Thomas]", "the strict corner"],
     ["δ=0 boundary ⇔", "classical entropy floor"]),
    (1.9,
     ["Twenty Questions:", "N candidates,", "log₂(N) questions,", "each halves the set", "(if answers are RARE)"],
     ["Group-splitting zoom:", "F flagged, k criticals,", "k·log₂(F/k) opens", "vs F flat reads,", "measured 15.3× [b1_frontier.py]"],
     ["pays ONLY in the", "sparse-flagged regime"]),
]

for y, base_lines, target_lines, label_lines in rows:
    n_b = len(base_lines)
    for i, s in enumerate(base_lines):
        ax.text(2.0, y + 0.42 * (n_b - 1) / 2 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    n_t = len(target_lines)
    for i, s in enumerate(target_lines):
        ax.text(10.0, y + 0.42 * (n_t - 1) / 2 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    arrow = FancyArrowPatch((3.9, y - 0.15), (8.1, y - 0.15), arrowstyle='<->',
                             mutation_scale=20, linewidth=1.8, color=shipred, alpha=0.85,
                             connectionstyle="arc3,rad=0.08")
    ax.add_patch(arrow)
    for i, s in enumerate(label_lines):
        ax.text(6.0, y + 0.62 - 0.38 * i, s, fontsize=9, ha='center', va='center', color=shipred, weight='bold')

ax.text(6.0, 0.25,
        "One dial, three faces: the constraint that got added, the boundary where it collapses back to Shannon, and the search "
        "cost it buys.  R(0,0.10)=0.186, R(0.01,0.10)=0.110, R(0.04,0.06)=0.009 bits/sym [internal, b1_frontier.py].",
        fontsize=8, ha='center', va='center', style='italic')

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r4_relation.png', dpi=dpi, bbox_inches='tight')
plt.close()

# ============================================================================
# Figure 2: r4_regime.png — REGIME DIAGRAM (two panels)
#   Panel A: the two-constraint rate R(delta,f) surface (curves in f, at a
#            few delta) for Bernoulli(0.05), with the compendium's three
#            internal numbers and the verified zero-miss entropy corner
#            marked directly on the curves that produce them.
#   Panel B: the zoom advantage vs flagged-set density — the boundary where
#            adaptive group-splitting stops paying (advantage = 1).
# ============================================================================

fig, (axA, axB) = plt.subplots(1, 2, figsize=(13, 5.2), dpi=dpi)

# --- Panel A: R(delta, f) curves ---------------------------------------
p = 0.05
deltas = [0.0, 0.01, 0.04]
colors_a = [harborblue, seagreen, shipred]
styles_a = ['-', '--', '-.']

for delta, c, ls in zip(deltas, colors_a, styles_a):
    f_lo = max(p - delta, delta) + 1e-6
    f_grid = np.linspace(f_lo, 0.4, 400)
    R = np.array([rate_general(p, f, delta) for f in f_grid])
    axA.plot(f_grid, R, color=c, lw=2.2, ls=ls, label=fr'$\delta$={delta:.2f}')

# Verified zero-miss entropy corner: R(0, f->p) = H(p)
Hp = -(p * np.log2(p) + (1 - p) * np.log2(1 - p))
axA.scatter([p], [Hp], color=harborblue, s=90, zorder=5, marker='D', edgecolors='black', linewidth=1.0)
axA.annotate(f'R(0,f→p)=H(p)={Hp:.3f}\n[verified, Cover–Thomas]',
             xy=(p, Hp), xytext=(0.15, 0.235), fontsize=8,
             bbox=dict(boxstyle='round,pad=0.35', facecolor=harborblue, alpha=0.10, edgecolor=harborblue, linewidth=1),
             arrowprops=dict(arrowstyle='->', color=harborblue, lw=1.3))

# Internal numbers, marked on the curves that produce them
pts = [(0.10, 0.0, 0.186, harborblue, (0.17, 0.30)),
       (0.10, 0.01, 0.110, seagreen, (0.20, 0.16)),
       (0.06, 0.04, 0.009, shipred, (0.13, 0.05))]
for f0, d0, r0, c, txy in pts:
    r_check = rate_general(p, f0, d0)
    axA.scatter([f0], [r_check], color=c, s=60, zorder=5, marker='o', edgecolors='black', linewidth=0.8)
    axA.annotate(f'R({d0:.2f},{f0:.2f})={r0:.3f}\n[internal]', xy=(f0, r_check), xytext=txy,
                 fontsize=8, color=c,
                 arrowprops=dict(arrowstyle='->', color=c, lw=1.0))

axA.set_xlabel('flag rate $f$', fontsize=10, weight='bold')
axA.set_ylabel('rate $R(\\delta,f)$ (bits/sym)', fontsize=10, weight='bold')
axA.set_title('Panel A — the two-constraint rate surface\n(Bernoulli $p$=0.05)', fontsize=10.5, weight='bold')
axA.spines['top'].set_visible(False)
axA.spines['right'].set_visible(False)
axA.grid(alpha=0.2)
axA.set_xlim(0, 0.4)
axA.set_ylim(0, 0.34)
axA.legend(fontsize=8.5, loc='upper right', title='miss tolerance')

# --- Panel B: zoom advantage vs flagged-set density ---------------------
F = 2500
densities = np.logspace(np.log10(0.001), np.log10(0.7), 200)
k_values = densities * F

advantage = np.zeros_like(k_values)
for i, k in enumerate(k_values):
    if 0 < k < F:
        log_ratio = np.log2(F / k)
        advantage[i] = F / (k * log_ratio) if log_ratio > 0 else np.nan
    else:
        advantage[i] = np.nan

axB.loglog(densities, advantage, color=harborblue, linewidth=2.5, label='zoom advantage')
axB.axhline(y=1, color=seagreen, linestyle='--', linewidth=2, label='zoom stops paying', zorder=2)

mask = advantage > 1
if np.any(mask):
    axB.fill_between(densities[mask], 1, advantage[mask], alpha=0.10, color=harborblue, label='sparse regime — zoom wins')

measured_density = 10 / 2500
measured_advantage = 15.3
axB.scatter([measured_density], [measured_advantage], color=shipred, s=130, zorder=5, marker='o',
            edgecolors='darkred', linewidth=1.5)
axB.annotate("measured 15.3×\n(ideal ≈31×, ≈2× overhead)\n[b1_frontier.py]",
             xy=(measured_density, measured_advantage), xytext=(0.02, 30), fontsize=8,
             bbox=dict(boxstyle='round,pad=0.35', facecolor=shipred, alpha=0.10, edgecolor=shipred, linewidth=1),
             arrowprops=dict(arrowstyle='->', color=shipred, lw=1.3))

axB.set_xlabel('flagged-set density (k/F)', fontsize=10, weight='bold')
axB.set_ylabel('open-count advantage $F/(k\\log_2(F/k))$', fontsize=10, weight='bold')
axB.set_title('Panel B — the sparse-flagged boundary\n(F=2500)', fontsize=10.5, weight='bold')
axB.spines['top'].set_visible(False)
axB.spines['right'].set_visible(False)
axB.grid(True, which='both', alpha=0.2, linestyle='-', linewidth=0.5)
axB.legend(loc='upper right', fontsize=8.5, framealpha=0.95)
axB.set_xlim(0.0008, 0.8)
axB.set_ylim(0.8, 100)

fig.suptitle('R4 regime — the two-constraint dial and the boundary where zooming stops paying',
             fontsize=12.5, weight='bold', y=1.02)

fig.canvas.draw()
xlo, xhi = axB.get_xlim()
ylo, yhi = axB.get_ylim()
axB.set_xticks([t for t in axB.get_xticks() if xlo * 0.999 <= t <= xhi * 1.001])
axB.set_yticks([t for t in axB.get_yticks() if ylo * 0.999 <= t <= yhi * 1.001])

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r4_regime.png', dpi=dpi, bbox_inches='tight')
plt.close()

print("R4 figures generated successfully")
