#!/usr/bin/env python3
"""
R4 figures: digest-zoom frontier
Two PNG outputs: r4_relation.png and r4_regime.png
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
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
# Figure 1: r4_relation.png — RELATION-MAP (three columns)
# ============================================================================

fig, ax = plt.subplots(figsize=(10, 6), dpi=dpi)
ax.set_xlim(0, 10)
ax.set_ylim(0, 10)
ax.axis('off')

# Title
ax.text(5, 9.5, "R4 — zoom is twenty questions, and twenty questions needs a rare answer",
        ha='center', va='top', fontsize=11, weight='bold')

# Three columns: LEFT (base), MIDDLE (arrows), RIGHT (target)

# LEFT COLUMN: Twenty Questions (base concept)
x_left = 1.5
y_start = 8.5

box_left = Rectangle((0.2, 3.7), 2.9, 5.2,
                      edgecolor=harborblue, facecolor=harborblue, alpha=0.12, linewidth=1.5)
ax.add_patch(box_left)
ax.text(x_left, y_start, "Twenty Questions", ha='center', fontsize=10, weight='bold')

items_left = [
    "Start: N candidates",
    "",
    "Each question halves",
    "the set (if answers",
    "are RARE among",
    "candidates)",
    "",
    "log₂(N) questions",
    "to find the answer"
]

y = y_start - 1.2
for item in items_left:
    if item:
        ax.text(x_left, y, item, ha='center', fontsize=9, style='italic' if 'RARE' in item else 'normal')
    y -= 0.45

# RIGHT COLUMN: Group-Splitting Zoom (target concept)
x_right = 8.5

box_right = Rectangle((6.9, 3.7), 2.9, 5.2,
                       edgecolor=seagreen, facecolor=seagreen, alpha=0.12, linewidth=1.5)
ax.add_patch(box_right)
ax.text(x_right, y_start, "Group-Splitting Zoom", ha='center', fontsize=10, weight='bold')

items_right = [
    "F flagged items",
    "k are criticals",
    "",
    "Each group-split halves",
    "the examined group",
    "(if criticals are RARE",
    "within the flagged set)",
    "",
    "k·log₂(F/k) opens",
    "vs F flat reads"
]

y = y_start - 1.2
for item in items_right:
    if item:
        ax.text(x_right, y, item, ha='center', fontsize=9, style='italic' if 'RARE' in item else 'normal')
    y -= 0.45

# MIDDLE: connecting arrow and insight
x_mid = 5

# Horizontal arrow connecting the two concepts
y_connection = 5.3
arrow3 = FancyArrowPatch((x_left + 1.5, y_connection), (x_right - 1.5, y_connection),
                         arrowstyle='<->', mutation_scale=25, linewidth=2.5, color=shipred, alpha=0.85)
ax.add_patch(arrow3)

ax.text(x_mid, y_connection + 0.35, "each question halves",
        ha='center', fontsize=9, weight='bold', style='italic', color=shipred)
ax.text(x_mid, y_connection - 0.35, "⇔ each group-split halves",
        ha='center', fontsize=9, weight='bold', style='italic', color=shipred)

# Key insight at bottom
insight_box = Rectangle((1, 0.4), 8, 1.4,
                         edgecolor=shipred, facecolor=shipred, alpha=0.08, linewidth=1.5)
ax.add_patch(insight_box)

ax.text(x_mid, 1.35, "Advantage requires SPARSITY",
        ha='center', fontsize=10, weight='bold', color=shipred)
ax.text(x_mid, 0.85, "zoom wins only when criticals are rare among flagged items",
        ha='center', fontsize=9, style='italic')

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r4_relation.png', dpi=dpi, bbox_inches='tight')
plt.close()

# ============================================================================
# Figure 2: r4_regime.png — REGIME DIAGRAM
# ============================================================================

# Compute advantage curve: F/(k·log2(F/k))
F = 2500

# Density range: k/F from 0.001 to 0.7
densities = np.logspace(np.log10(0.001), np.log10(0.7), 200)
k_values = densities * F

# Guard against log domain issues
advantage = np.zeros_like(k_values)
for i, k in enumerate(k_values):
    if k > 0 and k < F:
        log_ratio = np.log2(F / k)
        if log_ratio > 0:
            advantage[i] = F / (k * log_ratio)
        else:
            advantage[i] = np.nan
    else:
        advantage[i] = np.nan

fig, ax = plt.subplots(figsize=(10, 6), dpi=dpi)

# Plot the advantage curve
ax.loglog(densities, advantage, color=harborblue, linewidth=2.5, label='Zoom advantage')

# Horizontal line at advantage = 1 (zoom stops paying)
ax.axhline(y=1, color=seagreen, linestyle='--', linewidth=2, label='zoom stops paying', zorder=2)

# Shade the region where advantage > 1 (sparse regime)
# Find where advantage > 1
mask = advantage > 1
if np.any(mask):
    x_fill = densities[mask]
    y_fill = advantage[mask]
    # Create a filled area
    ax.fill_between(x_fill, 1, y_fill, alpha=0.08, color=harborblue, label='sparse regime — zoom wins')

# Measured point: k=10, F=2500, density=0.004, advantage=15.3
measured_density = 10 / 2500
measured_advantage = 15.3
ax.scatter([measured_density], [measured_advantage], color=shipred, s=150, zorder=5, marker='o', edgecolors='darkred', linewidth=1.5)

# Annotate measured point with detailed label
annotation_text = "measured 15.3×\n(ideal ≈31×, ≈2× overhead)\n[b1_frontier.py]"
ax.annotate(annotation_text, xy=(measured_density, measured_advantage),
            xytext=(0.015, 25), fontsize=8,
            bbox=dict(boxstyle='round,pad=0.4', facecolor=shipred, alpha=0.1, edgecolor=shipred, linewidth=1),
            arrowprops=dict(arrowstyle='->', color=shipred, lw=1.5))

# Labels and formatting
ax.set_xlabel('flagged-set density (k/F)', fontsize=10, weight='bold')
ax.set_ylabel('open-count advantage F/(k·log₂(F/k))', fontsize=10, weight='bold')
ax.set_title('R4 regime — the zoom advantage lives in the sparse-flagged corner', fontsize=11, weight='bold', pad=15)

# Hide top and right spines
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

# Adjust grid
ax.grid(True, which='both', alpha=0.2, linestyle='-', linewidth=0.5)

# Legend
ax.legend(loc='upper right', fontsize=9, framealpha=0.95)

# Set axis limits
ax.set_xlim(0.0008, 0.8)
ax.set_ylim(0.8, 100)

# Prune any auto-generated log-scale ticks that fall outside the final view
# limits (LogLocator emits one boundary decade beyond an explicit set_xlim/
# set_ylim; its Text stays "visible" though never actually drawn).
fig.canvas.draw()
xlo, xhi = ax.get_xlim()
ylo, yhi = ax.get_ylim()
ax.set_xticks([t for t in ax.get_xticks() if xlo * 0.999 <= t <= xhi * 1.001])
ax.set_yticks([t for t in ax.get_yticks() if ylo * 0.999 <= t <= yhi * 1.001])

plt.tight_layout()
plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r4_regime.png', dpi=dpi, bbox_inches='tight')
plt.close()

print("R4 figures generated successfully")
