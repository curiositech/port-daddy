#!/usr/bin/env python3
"""
R10 Figures: ε-ledger conservation (A3)
- r10_relation.png: RELATION-MAP (double-entry bookkeeping ⇔ privacy budget ledger)
- r10_regime.png: REGIME DIAGRAM (composition comparison at δ'=1e-6)
"""

from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

FIGURES_DIR = Path(__file__).resolve().parents[1]

# Set seed for deterministic output
np.random.seed(20260816)

# House colors (from task)
harborblue = (30/255, 70/255, 110/255)
shipred = (140/255, 30/255, 30/255)
seagreen = (31/255, 110/255, 70/255)

# ============================================================================
# Figure 1: RELATION-MAP (bank ledger ⇔ ε-release ledger, three substantive rows)
# ============================================================================

fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
ax.set_xlim(0, 12)
ax.set_ylim(0, 10.6)
ax.axis('off')

ax.text(6, 10.3, "R10 — the privacy budget is double-entry bookkeeping",
        fontsize=12, weight='bold', ha='center', va='top')

# Base column (left): a bank ledger
ax.add_patch(FancyBboxPatch((0.2, 0.7), 3.6, 8.7,
                             boxstyle="round,pad=0,rounding_size=0.18",
                             edgecolor=harborblue, facecolor=harborblue,
                             alpha=0.12, linewidth=1.5))
ax.text(2.0, 9.05, "Base: the ledger book", fontsize=11, weight='bold',
        ha='center', va='center')

# Target column (right): the release ledger (σ, Λ)
ax.add_patch(FancyBboxPatch((8.2, 0.7), 3.6, 8.7,
                             boxstyle="round,pad=0,rounding_size=0.18",
                             edgecolor=seagreen, facecolor=seagreen,
                             alpha=0.12, linewidth=1.5))
ax.text(10.0, 9.05, "Target: the ε-release ledger", fontsize=11, weight='bold',
        ha='center', va='center')

rows = [
    # (y, base lines, target lines, label lines, curvature)
    (7.4,
     ["Debit and credit post", "in a single stroke —", "no half-written entry", "is ever readable"],
     ["release(εᵢ) atomically", "appends (εᵢ, artifact hash,", "policy hash) to Λ AND adds", "εᵢ to σ — single-writer"],
     ["one-stroke posting", "⇔ atomic append + add"],
     0.12),
    (4.6,
     ["Book-keeper refuses a", "posting that would push", "the running balance past", "the authorized credit line"],
     ["gate refuses release(εᵢ)", "when σ + εᵢ > εmax;", "holds over every concurrent", "interleaving (induction)"],
     ["credit-line gate", "⇔ σ + εᵢ ≤ εmax, always"],
     -0.12),
    (1.9,
     ["Same ledger, two methods:", "cash-basis vs accrual give", "the identical balance a", "different certified meaning"],
     ["sequential ⇒ (εmax,0)-DP;", "advanced (Dwork–Rothblum–", "Vadhan) pays only past the", "k≈35 composition crossover"],
     ["accounting method", "⇔ which DP composition"],
     0.12),
]

for y, base_lines, target_lines, label_lines, rad in rows:
    for i, s in enumerate(base_lines):
        ax.text(2.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    for i, s in enumerate(target_lines):
        ax.text(10.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
    arrow = FancyArrowPatch((3.9, y - 0.15), (8.1, y - 0.15), arrowstyle='<->',
                             mutation_scale=20, linewidth=1.8, color=shipred, alpha=0.85,
                             connectionstyle=f"arc3,rad={rad}")
    ax.add_patch(arrow)
    for i, s in enumerate(label_lines):
        ax.text(6.0, y + 0.62 - 0.38 * i, s, fontsize=9, ha='center',
                va='center', color=shipred, weight='bold')

ax.text(6.0, 0.25,
        "The ledger conserves the meter, not the meaning: honest per-release εᵢ is the DP mechanism's obligation "
        "(recorded spend only — complete mediation is R5's assumption).",
        fontsize=8.5, ha='center', va='center', style='italic')

plt.tight_layout()
plt.savefig(FIGURES_DIR / 'r10_relation.png',
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
plt.savefig(FIGURES_DIR / 'r10_regime.png',
            dpi=150, bbox_inches='tight')
plt.close()

print("R10 figures generated successfully.")
