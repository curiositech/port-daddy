#!/usr/bin/env python3
"""
R7 Inspection Tower figures: RELATION-MAP and REGIME DIAGRAM
Generates two PNG figures for the harbor-exposition Rail-B pair.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

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
# Figure 1: RELATION-MAP (three columns)
# ============================================================================

fig, ax = plt.subplots(figsize=(10, 5), dpi=150)
ax.set_xlim(0, 10)
ax.set_ylim(0, 5)
ax.axis('off')

# Column 1: Speeding (left)
col1_x = 1.5
ax.text(col1_x, 4.5, 'Speeding', fontsize=11, fontweight='bold', ha='center')
ax.text(col1_x, 3.9, 'Fine F × patrol% p', fontsize=9, ha='center', style='italic')
ax.text(col1_x, 3.4, 'Time saved ≡ benefit T', fontsize=9, ha='center')
ax.text(col1_x, 2.9, 'Obey if:', fontsize=10, fontweight='bold', ha='center')
ax.text(col1_x, 2.3, 'F·p ≥ T', fontsize=10, ha='center',
        bbox=dict(boxstyle='round,pad=0.3', facecolor='lightyellow', alpha=0.7))
ax.text(col1_x, 1.6, 'City need not', fontsize=9, ha='center', style='italic')
ax.text(col1_x, 1.1, 'catch every car', fontsize=9, ha='center', style='italic')

# Column 2: Arrows/mapping — vertical arrow shafts sit left of their labels
# so the label text never crosses the arrow line
col2_x = 5
arrow_props = dict(arrowstyle='<->', lw=2, color=harborblue)
ax.annotate('', xy=(col2_x - 0.9, 3.8), xytext=(col2_x - 0.9, 2.4),
            arrowprops=arrow_props)
ax.text(col2_x - 0.6, 3.1, 'expected fine\n⇔\nexpected slash',
        fontsize=9, ha='left', va='center', weight='bold', color=harborblue)

arrow_props2 = dict(arrowstyle='<->', lw=2, color=harborblue)
ax.annotate('', xy=(col2_x - 0.9, 1.5), xytext=(col2_x - 0.9, 1.0),
            arrowprops=arrow_props2)
ax.text(col2_x - 0.6, 1.25, 'patrol budget\n⇔\naudit rate ρ*',
        fontsize=9, ha='left', va='center', weight='bold', color=harborblue)

# Column 3: Agents (right)
col3_x = 8.5
ax.text(col3_x, 4.5, 'Agent honesty', fontsize=11, fontweight='bold', ha='center')
ax.text(col3_x, 3.9, 'Bond B × audit ρ × detect d', fontsize=9, ha='center', style='italic')
ax.text(col3_x, 3.4, 'One-shot gain G', fontsize=9, ha='center')
ax.text(col3_x, 2.9, 'Honest if:', fontsize=10, fontweight='bold', ha='center')
ax.text(col3_x, 2.3, 'ρ·d·B ≥ G', fontsize=10, ha='center',
        bbox=dict(boxstyle='round,pad=0.3', facecolor='lightgreen', alpha=0.7))
ax.text(col3_x, 1.6, 'Deterrence iff', fontsize=9, ha='center', style='italic')
ax.text(col3_x, 1.1, 'ρ* = G/(dB)', fontsize=9, ha='center', style='italic')

# Title
fig.suptitle('R7 — honesty is priced like speeding', fontsize=11, fontweight='bold', y=0.98)

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
