#!/usr/bin/env python3
"""
Harbor R11 figures: canary power and SPRT latency (item A4)
Relation-map (dye packs → data canaries) and regime diagram (operating curve)
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch
from scipy.stats import hypergeom
import os

# Colors (from house rules)
HARBOR_BLUE = (30/255, 70/255, 110/255)
SHIP_RED = (140/255, 30/255, 30/255)
SEA_GREEN = (31/255, 110/255, 70/255)

# DPI and style
DPI = 150
BBOX_INCHES = 'tight'
FONT_SIZE_TITLE = 11
FONT_SIZE_AXIS = 10
FONT_SIZE_LABEL = 9

# Ensure output directory exists
output_dir = '/home/user/port-daddy/docs/harbor-research/figures'
os.makedirs(output_dir, exist_ok=True)

# ============================================================================
# Figure 1: R11 Relation Map (dye packs → canaries analogy)
# ============================================================================

fig1, ax1 = plt.subplots(figsize=(12, 5), dpi=DPI)
ax1.set_xlim(0, 10)
ax1.set_ylim(0, 6)
ax1.axis('off')

# Title
ax1.text(5, 5.5, 'R11 — dye packs for data',
         fontsize=FONT_SIZE_TITLE, weight='bold', ha='center',
         transform=ax1.transData)

# Left column: Base (dye pack model)
x_left = 1.2
y_base = 3.5

# Dye pack box
rect_left = Rectangle((x_left - 0.8, y_base - 1), 1.6, 2,
                           edgecolor=HARBOR_BLUE, facecolor=HARBOR_BLUE, alpha=0.10, linewidth=2)
ax1.add_patch(rect_left)
ax1.text(x_left, y_base + 0.6, 'Base', fontsize=FONT_SIZE_AXIS, weight='bold', ha='center')
ax1.text(x_left, y_base + 0.2, 'Dye Packs', fontsize=FONT_SIZE_LABEL, ha='center', style='italic')
ax1.text(x_left, y_base - 0.2, 'in bank bundles', fontsize=FONT_SIZE_LABEL, ha='center', style='italic')
ax1.text(x_left, y_base - 0.6, r'each fails w.p. $\beta$', fontsize=FONT_SIZE_LABEL, ha='center')

# Right column: Target (canary model)
x_right = 8.8
# Canary box
rect_right = Rectangle((x_right - 0.8, y_base - 1), 1.6, 2,
                            edgecolor=SHIP_RED, facecolor=SHIP_RED, alpha=0.10, linewidth=2)
ax1.add_patch(rect_right)
ax1.text(x_right, y_base + 0.6, 'Target', fontsize=FONT_SIZE_AXIS, weight='bold', ha='center')
ax1.text(x_right, y_base + 0.2, 'Canaries', fontsize=FONT_SIZE_LABEL, ha='center', style='italic')
ax1.text(x_right, y_base - 0.2, 'in corpus', fontsize=FONT_SIZE_LABEL, ha='center', style='italic')
ax1.text(x_right, y_base - 0.6, r'leak $m$ spans carries $K \sim \text{Hyp}$',
         fontsize=FONT_SIZE_LABEL, ha='center')

# Middle column: Mechanism
x_mid = 5
# Grab box
rect_mid = Rectangle((x_mid - 0.6, y_base + 0.2), 1.2, 0.8,
                          edgecolor='black', facecolor='white', linewidth=1)
ax1.add_patch(rect_mid)
ax1.text(x_mid, y_base + 0.6, 'grab k', fontsize=FONT_SIZE_LABEL, ha='center', weight='bold')

# Detection probability
ax1.text(x_mid, y_base - 0.5, r'detect w.p. $1-\beta^k$',
         fontsize=FONT_SIZE_LABEL, ha='center', weight='bold', color=HARBOR_BLUE)

# Arrow from left to middle: haul size
arrow1 = FancyArrowPatch((x_left + 0.9, y_base + 0.3), (x_mid - 0.65, y_base + 0.6),
                        arrowstyle='->', mutation_scale=20, linewidth=1.5, color='gray')
ax1.add_patch(arrow1)
ax1.text(2.5, y_base + 0.9, 'haul size', fontsize=FONT_SIZE_LABEL, ha='center', color='gray')

# Arrow from middle to right: leak volume
arrow2 = FancyArrowPatch((x_mid + 0.65, y_base + 0.6), (x_right - 0.9, y_base + 0.3),
                        arrowstyle='->', mutation_scale=20, linewidth=1.5, color='gray')
ax1.add_patch(arrow2)
ax1.text(7.5, y_base + 0.9, 'leak volume', fontsize=FONT_SIZE_LABEL, ha='center', color='gray')

# Equivalence annotations
ax1.text(x_left, y_base - 1.8, r'$\beta$ = per-pack failure', fontsize=FONT_SIZE_LABEL,
         ha='center', style='italic', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
ax1.text(x_right, y_base - 1.8, r'$\beta$ = per-canary miss', fontsize=FONT_SIZE_LABEL,
         ha='center', style='italic', bbox=dict(boxstyle='round', facecolor='lightcyan', alpha=0.5))

# Operating curve label
ax1.text(5, 0.8, r'Operating curve: $\Pr(\text{detect}) = 1 - (1 - \frac{c}{n}(1-\beta))^m$',
         fontsize=FONT_SIZE_LABEL, ha='center', weight='bold',
         bbox=dict(boxstyle='round', facecolor='lightyellow', alpha=0.7))

plt.tight_layout()
plt.savefig(os.path.join(output_dir, 'r11_relation.png'), dpi=DPI, bbox_inches=BBOX_INCHES)
plt.close()

# ============================================================================
# Figure 2: R11 Regime Diagram (operating curve and broken-secrecy boundary)
# ============================================================================

fig2, ax2 = plt.subplots(figsize=(9, 6), dpi=DPI)

# Parameters
n = 10000  # total spans
c = 100    # canaries planted
beta = 0.2 # per-canary miss probability

# Leak size range (log scale)
m_values = np.logspace(np.log10(10), np.log10(1000), 100)

# Operating curve: 1 - (1 - (c/n)(1-beta))^m
p_base = c / n  # 0.01
detection_curve = 1 - (1 - p_base * (1 - beta)) ** m_values

# Broken-secrecy boundary: multiply by (1 - 0.3) = 0.7
detection_broken = detection_curve * (1 - 0.3)

# Measured data points [internal, a4_canary_sprt.py]
m_measured = np.array([25, 50, 100, 200, 400, 800])
power_measured = np.array([0.182, 0.331, 0.554, 0.802, 0.962, 0.999])

# Plot
ax2.loglog(m_values, detection_curve, color=HARBOR_BLUE, linewidth=2.5, label='Operating curve (secure)')
ax2.loglog(m_values, detection_broken, color=SHIP_RED, linewidth=2.5, linestyle='--',
           label='Adversary strips canary list (w.p. 0.3)')
ax2.scatter(m_measured, power_measured, color=SHIP_RED, s=80, zorder=5, marker='o',
            edgecolors='darkred', linewidths=1.5, label='Measured [internal, a4_canary_sprt.py]')

# Annotations
ax2.axhline(y=0.5, color='gray', linestyle=':', alpha=0.5, linewidth=1)
ax2.text(15, 0.56, '50% detection', fontsize=FONT_SIZE_LABEL - 1, color='gray', alpha=0.9)

# Labels
ax2.set_xlabel('Leak size (spans, log scale)', fontsize=FONT_SIZE_AXIS, weight='bold')
ax2.set_ylabel('Probability of detection', fontsize=FONT_SIZE_AXIS, weight='bold')
ax2.set_title(r'R11 regime — the operating curve a CISO can buy, and the boundary that voids it',
              fontsize=FONT_SIZE_TITLE, weight='bold', pad=12)

# Grid and spine hiding (house rules)
ax2.grid(True, which='major', alpha=0.3, linestyle='-', linewidth=0.5)
ax2.grid(True, which='minor', alpha=0.1, linestyle=':', linewidth=0.3)
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)

# Legend
ax2.legend(loc='lower right', fontsize=FONT_SIZE_LABEL, framealpha=0.9, edgecolor='black')

# Set y-axis limits and ticks
ax2.set_ylim(0.001, 1.2)
ax2.set_xlim(8, 1200)

# Prune any auto-generated log-scale ticks that fall outside the final view
# limits (LogLocator emits one boundary decade beyond an explicit set_xlim/
# set_ylim; its Text stays "visible" though never actually drawn).
fig2.canvas.draw()
xlo, xhi = ax2.get_xlim()
ylo, yhi = ax2.get_ylim()
ax2.set_xticks([t for t in ax2.get_xticks() if xlo * 0.999 <= t <= xhi * 1.001])
ax2.set_yticks([t for t in ax2.get_yticks() if ylo * 0.999 <= t <= yhi * 1.001])

plt.tight_layout()
plt.savefig(os.path.join(output_dir, 'r11_regime.png'), dpi=DPI, bbox_inches=BBOX_INCHES)
plt.close()

# Report file sizes
import os
path1 = os.path.join(output_dir, 'r11_relation.png')
path2 = os.path.join(output_dir, 'r11_regime.png')

size1 = os.path.getsize(path1) / 1024  # KB
size2 = os.path.getsize(path2) / 1024  # KB

print(f"✓ r11_relation.png: {size1:.1f} KB")
print(f"✓ r11_regime.png: {size2:.1f} KB")
print(f"\nBoth files > 20 KB: {size1 > 20 and size2 > 20}")
