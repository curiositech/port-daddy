#!/usr/bin/env python3
"""
R7 Inspection Tower figures: RELATION-MAP and REGIME DIAGRAM
Generates two PNG figures for the harbor-exposition Rail-B pair.
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import FancyArrowPatch, Rectangle

# Set seed for deterministic output
np.random.seed(20260816)

# Color palette (house rules)
harborblue = (30/255, 70/255, 110/255)
shipred = (140/255, 30/255, 30/255)
seagreen = (31/255, 110/255, 70/255)

# Parameters from R7 numbers section
G = 10      # one-shot gain from cheating
d = 0.8     # detection probability
B = 50      # bond size
rho_star = G / (d * B)  # audit rate at equilibrium = 0.25
C = 8       # number of cliques

# ============================================================================
# Figure 1: RELATION-MAP (Base: one audited inspector -> Target: the tower)
# ============================================================================

fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
ax.set_xlim(0, 12)
ax.set_ylim(0, 10.6)
ax.axis('off')

ax.text(6, 10.3, 'R7 — reputation is amortized verification',
        fontsize=12, weight='bold', ha='center', va='top', color=harborblue)

# Base domain (left): the single Becker inspection game
ax.add_patch(Rectangle((0.2, 0.7), 3.6, 8.7, edgecolor=harborblue,
                        facecolor=harborblue, alpha=0.12, linewidth=1.5))
ax.text(2.0, 9.05, 'Base: one audited inspector', fontsize=11, weight='bold',
        ha='center', va='center')

# Target domain (right): the sealed-sampling tower
ax.add_patch(Rectangle((8.2, 0.7), 3.6, 8.7, edgecolor=seagreen,
                        facecolor=seagreen, alpha=0.12, linewidth=1.5))
ax.text(10.0, 9.05, 'Target: the inspection tower', fontsize=11, weight='bold',
        ha='center', va='center')

rows = [
    # (y, base lines, target lines, connective label lines)
    (7.4,
     ['One-shot gain G,', 'audit prob ρ, detect d,', 'bond B posted once', 'Honest iff ρ·d·B ≥ G'],
     ['Same threshold, sealed:', 'draw comes from C=8', 'disjoint cliques —', 'ρ* = G/(dB) unchanged'],
     ['single audit ⇔ sealed audit', 'briber who learns the draw', 'beats the math']),
    (4.6,
     ['Bribe the one inspector,', 'pocket G, done —', 'no notion of "depth"'],
     ['Bribe floor β = ρdB/level;', 'pays only if G_k > C·B,', 'else G_{k+1} = (1−ρd)G_k'],
     ['one bribe ⇔ bribe floor', 'climbs ×C per level down', '(finite bond, unbounded depth)']),
    (1.9,
     ['Flat patrol forever:', 'audit spend grows', 'Θ(T) over the horizon'],
     ['Vest the bond: ρ_t = G/(d(B+vt))', '⇒ Θ(log T) spend; add', 'whistleblowers ⇒ O(1) spend'],
     ['flat patrol ⇔ amortized', 'ladder Θ(log T) / O(1)', '(pre-saturation caveat applies)']),
]

for y, base_lines, target_lines, label_lines in rows:
    for i, s in enumerate(base_lines):
        ax.text(2.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    for i, s in enumerate(target_lines):
        ax.text(10.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    arrow = FancyArrowPatch((3.9, y - 0.15), (8.1, y - 0.15), arrowstyle='<->',
                             mutation_scale=20, linewidth=1.8, color=shipred, alpha=0.85,
                             connectionstyle='arc3,rad=0.08')
    ax.add_patch(arrow)
    for i, s in enumerate(label_lines):
        ax.text(6.0, y + 0.62 - 0.38 * i, s, fontsize=8.8, ha='center',
                va='center', color=shipred, weight='bold')

ax.text(6.0, 0.25,
        'The tower prices depth, not detection: a finite bond, sealed against the draw, certifies unbounded levels.',
        fontsize=8.5, ha='center', va='center', style='italic')

# Save
plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r7_relation.png',
            dpi=150, bbox_inches='tight')
plt.close()

# ============================================================================
# Figure 2: REGIME DIAGRAM (bond vs audit rate)
# ============================================================================

fig, ax = plt.subplots(figsize=(8, 6), dpi=150)

# Axes
B_range = np.linspace(10, 100, 200)
rho_range = np.linspace(0, 1, 200)

# Curve: ρ = G / (d·B)
rho_curve = G / (d * B_range)
rho_curve = np.clip(rho_curve, 0, 1)

# Fill regions
# Above curve: deterrence holds (seagreen)
ax.fill_between(B_range, rho_curve, 1.0, alpha=0.10, color=seagreen,
                label='deterrence holds\n(cheating unprofitable)')
# Below curve: cheating pays (shipred)
ax.fill_between(B_range, 0, rho_curve, alpha=0.06, color=shipred,
                label='cheating pays')

# Plot the boundary curve
ax.plot(B_range, rho_curve, color=harborblue, lw=2.5, label='ρ = G/(dB)')

# Mark measured point (B=50, ρ*=0.25)
ax.plot(50, 0.25, 'o', color=shipred, markersize=10, markeredgewidth=1.5,
        markeredgecolor='darkred', zorder=5)
ax.annotate('measured: cheat payoff\nexactly 0 at ρ*\n[internal, b2_tower.py]',
            xy=(50, 0.25), xytext=(65, 0.05),
            fontsize=8, ha='left', style='italic',
            bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                     edgecolor=shipred, linewidth=1),
            arrowprops=dict(arrowstyle='->', color=shipred, lw=1.5))

# Secondary annotation box (tower info) — placed in the open cheating-pays
# corner (low B, low rho) so it never touches the boundary curve or legend
tower_text = ('tower: sealed sampling from C cliques\n'
              '⇒ corruption decays (1−ρd)^k\n'
              'C=8 collapses ×0.8/level')
ax.text(0.03, 0.40, tower_text, transform=ax.transAxes,
        fontsize=8, ha='left', va='top', style='italic',
        bbox=dict(boxstyle='round,pad=0.5', facecolor='lightyellow',
                 edgecolor=harborblue, linewidth=1.5, alpha=0.9))

# Axis labels and formatting
ax.set_xlabel('Bond size B', fontsize=10, fontweight='bold')
ax.set_ylabel('Audit rate ρ', fontsize=10, fontweight='bold')
ax.set_xlim(10, 100)
ax.set_ylim(0, 1)

# Hide top and right spines
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_color(harborblue)
ax.spines['bottom'].set_color(harborblue)
ax.spines['left'].set_linewidth(1)
ax.spines['bottom'].set_linewidth(1)

# Grid
ax.grid(True, alpha=0.2, linestyle='--', linewidth=0.5, color='gray')

# Legend
ax.legend(loc='upper right', fontsize=8, framealpha=0.95, edgecolor='gray')

# Title
ax.set_title('R7 regime — the deterrence frontier ρdB = G',
             fontsize=11, fontweight='bold', pad=12)

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r7_regime.png',
            dpi=150, bbox_inches='tight')
plt.close()

print("R7 figures generated successfully.")
