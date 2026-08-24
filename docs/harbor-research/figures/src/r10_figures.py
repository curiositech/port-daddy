#!/usr/bin/env python3
"""
R10 Figures: ε-ledger conservation (A3)
- r10_relation.png: RELATION-MAP (double-entry bookkeeping ⇔ privacy budget ledger)
- r10_regime.png: REGIME DIAGRAM (composition comparison at δ'=1e-6)
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch

# Set seed for deterministic output
np.random.seed(20260816)

# House colors (from task)
harborblue = (30/255, 70/255, 110/255)
shipred = (140/255, 30/255, 30/255)
seagreen = (31/255, 110/255, 70/255)

# ============================================================================
# Figure 1: RELATION-MAP (three columns)
# ============================================================================

fig, ax = plt.subplots(figsize=(11, 6), dpi=150)
ax.set_xlim(0, 11)
ax.set_ylim(0, 6)
ax.axis('off')

# Title
ax.text(5.5, 5.7, "R10 — the privacy budget is double-entry bookkeeping",
        fontsize=11, weight='bold', ha='center', va='top')

# Column 1: Base Domain (double-entry bookkeeping)
col1_x = 1.8
col1_y = 4.0
box1 = Rectangle((0.3, col1_y-1.5), 3.0, 2.2,
                      edgecolor=harborblue, facecolor=harborblue,
                      alpha=0.12, linewidth=1.5)
ax.add_patch(box1)
ax.text(col1_x, col1_y+0.6, "Base: Accounting", fontsize=10, weight='bold',
        ha='center', va='center')
ax.text(col1_x, col1_y+0.1, "Double-entry", fontsize=9, ha='center', va='center')
ax.text(col1_x, col1_y-0.35, "Journal (all posts)", fontsize=9, ha='center', va='center')
ax.text(col1_x, col1_y-0.8, "Balance (cumulative sum)", fontsize=9, ha='center', va='center')
ax.text(col1_x, col1_y-1.25, "updated in ONE stroke", fontsize=8, ha='center', va='center',
        style='italic', color=shipred, weight='bold')

# Column 2: Mapping arrows
col2_x = 5.5
# Arrow 1: top mapping — label sits clear above the arrow shaft
arrow1 = FancyArrowPatch((3.3, col1_y+0.15), (6.7, col1_y+0.15),
                        arrowstyle='<->', mutation_scale=24,
                        linewidth=1.5, color=shipred, alpha=0.75)
ax.add_patch(arrow1)
ax.text(col2_x, col1_y+0.75, "one-stroke posting",
        fontsize=9, ha='center', va='bottom', weight='bold')
ax.text(col2_x, col1_y+0.45, "⇔ atomic append + add",
        fontsize=9, ha='center', va='bottom', weight='bold')

# Arrow 2: bottom mapping — label sits clear above the arrow shaft
arrow2 = FancyArrowPatch((3.3, col1_y-1.15), (6.7, col1_y-1.15),
                        arrowstyle='<->', mutation_scale=24,
                        linewidth=1.5, color=shipred, alpha=0.75)
ax.add_patch(arrow2)
ax.text(col2_x, col1_y-0.55, "journal audit:",
        fontsize=9, ha='center', va='bottom')
ax.text(col2_x, col1_y-0.85, "Σ entries = balance ⇔ log-sum invariant",
        fontsize=9, ha='center', va='bottom', weight='bold')

# Column 3: Target Domain (privacy budget ledger)
col3_x = 9.2
box2 = Rectangle((7.7, col1_y-1.5), 3.0, 2.2,
                      edgecolor=seagreen, facecolor=seagreen,
                      alpha=0.12, linewidth=1.5)
ax.add_patch(box2)
ax.text(col3_x, col1_y+0.6, "Target: DP Budget", fontsize=10, weight='bold',
        ha='center', va='center')
ax.text(col3_x, col1_y+0.1, "Release ledger Λ", fontsize=9, ha='center', va='center')
ax.text(col3_x, col1_y-0.35, "σ = Σ_Λ εᵢ", fontsize=9, ha='center', va='center', family='monospace')
ax.text(col3_x, col1_y-0.8, "gate: σ + εᵢ ≤ εmax", fontsize=9, ha='center', va='center', family='monospace')
ax.text(col3_x, col1_y-1.25, "every reachable state", fontsize=8, ha='center', va='center',
        style='italic', color=seagreen, weight='bold')

# Bottom interpretive text
ax.text(5.5, 1.8, "Every release(εᵢ) atomically appends record to Λ AND adds εᵢ to σ.",
        fontsize=9, ha='center', va='center', style='italic', color='gray')
ax.text(5.5, 1.3, "Auditor summing the log reproduces σ in every interleaving. Atomicity makes the budget auditable.",
        fontsize=9, ha='center', va='center', style='italic', color='gray')

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r10_relation.png',
            dpi=150, bbox_inches='tight')
plt.close()

# ============================================================================
# Figure 2: REGIME DIAGRAM (composition curves)
# ============================================================================

fig, ax = plt.subplots(figsize=(10, 6.5), dpi=150)

# Parameters
epsilon = 0.1  # base epsilon for the curves
delta_prime = 1e-6
log_delta = np.log(1.0 / delta_prime)  # ln(1/δ') ≈ 13.8155

# Generate k range on log scale from 4 to 256
k_values = np.logspace(np.log10(4), np.log10(256), 150)

# Composition formulas
basic_composition = k_values * epsilon
advanced_composition = (np.sqrt(2 * k_values * log_delta) * epsilon +
                       k_values * epsilon * (np.exp(epsilon) - 1))

# Find crossover point (where advanced < basic)
crossover_idx = np.where(advanced_composition < basic_composition)[0]
if len(crossover_idx) > 0:
    crossover_k = k_values[crossover_idx[0]]
else:
    crossover_k = None

# Plot the curves
ax.plot(k_values, basic_composition, color=harborblue, linewidth=2.5,
        label='basic sequential: k·ε', linestyle='-')
ax.plot(k_values, advanced_composition, color=seagreen, linewidth=2.5,
        label='advanced (Dwork–Rothblum–Vadhan): √(2k ln(1/δ\'))·ε + k·ε·(e^ε−1)',
        linestyle='-')

# Shade region where advanced < basic
if crossover_k is not None:
    # Find the range where advanced < basic
    mask = k_values >= crossover_k
    ax.fill_between(k_values[mask], advanced_composition[mask], basic_composition[mask],
                    color=seagreen, alpha=0.10, label='advanced accounting pays')

    # Mark the crossover with a dashed vertical line
    ax.axvline(crossover_k, color=shipred, linewidth=2.0, linestyle='--',
              label=f'crossover at k≈{crossover_k:.1f}')

# Measured points from compendium
# Point 1: k=32, ε=0.1, basic=3.20, advanced=3.31
k1, eps1 = 32, 0.1
basic1 = k1 * eps1
advanced1 = np.sqrt(2 * k1 * log_delta) * eps1 + k1 * eps1 * (np.exp(eps1) - 1)
ax.plot(k1, basic1, 'o', markersize=9, color=shipred, markeredgewidth=1.5,
       markeredgecolor='darkred', zorder=5)
ax.plot(k1, advanced1, 's', markersize=8, color=seagreen, markeredgewidth=1.5,
       markeredgecolor='darkgreen', zorder=5)
ax.annotate('k=32, ε=0.1\nbasic=3.20, advanced=3.31\n[verified]',
           xy=(k1, basic1), xytext=(k1*0.4, basic1+0.8),
           fontsize=8, ha='center', va='bottom', style='italic',
           bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                    edgecolor=shipred, alpha=0.95, linewidth=1),
           arrowprops=dict(arrowstyle='->', color=shipred, lw=1.2))

# Point 2: k=128, ε=0.05, basic=6.40, advanced=3.30
k2, eps2 = 128, 0.05
basic2 = k2 * eps2
log_delta2 = np.log(1.0 / delta_prime)
advanced2 = np.sqrt(2 * k2 * log_delta2) * eps2 + k2 * eps2 * (np.exp(eps2) - 1)
ax.plot(k2, basic2, 'o', markersize=9, color=harborblue, markeredgewidth=1.5,
       markeredgecolor='navy', zorder=5)
ax.plot(k2, advanced2, 's', markersize=8, color=seagreen, markeredgewidth=1.5,
       markeredgecolor='darkgreen', zorder=5)
ax.annotate('k=128, ε=0.05\nbasic=6.40, advanced=3.30\n[verified]',
           xy=(k2, advanced2), xytext=(42, 20),
           fontsize=8, ha='left', va='top', style='italic',
           bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                    edgecolor=seagreen, alpha=0.95, linewidth=1),
           arrowprops=dict(arrowstyle='->', color=seagreen, lw=1.2))

# Axis labels and title
ax.set_xlabel('number of releases k (log scale)', fontsize=10, weight='bold')
ax.set_ylabel('certified total ε', fontsize=10, weight='bold')
ax.set_title("R10 regime — which DP accounting to quote at which engagement length",
            fontsize=11, weight='bold', pad=12)

# Logarithmic x-axis
ax.set_xscale('log')
ax.set_xlim(4, 256)
ax.set_ylim(0, 30)

# Prune any auto-generated log-scale x ticks that fall outside the final
# view limits (LogLocator emits one boundary decade beyond an explicit
# set_xlim; its Text stays "visible" though never actually drawn).
fig.canvas.draw()
xlo, xhi = ax.get_xlim()
ax.set_xticks([t for t in ax.get_xticks() if xlo * 0.999 <= t <= xhi * 1.001])

# Grid and spines
ax.grid(True, alpha=0.25, linestyle='--', linewidth=0.5)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_linewidth(1)
ax.spines['bottom'].set_linewidth(1)

# Legend with δ' notation
legend_text = f"δ'=1e-6, ε={epsilon} (solid curves); δ' change shown by points at ε=0.05"
ax.text(0.02, 0.98, legend_text, transform=ax.transAxes,
       fontsize=8, ha='left', va='top', style='italic',
       bbox=dict(boxstyle='round,pad=0.4', facecolor='lightyellow',
                edgecolor=harborblue, linewidth=1, alpha=0.85))

# Legend
ax.legend(loc='lower right', fontsize=8.5, framealpha=0.95, edgecolor='gray')

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r10_regime.png',
            dpi=150, bbox_inches='tight')
plt.close()

print("R10 figures generated successfully.")
