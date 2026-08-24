#!/usr/bin/env python3
"""
R3 Figures: regret head / inspection decision
- r3_relation.png: RELATION-MAP (smoke detector → calibrated posterior)
- r3_regime.png: REGIME DIAGRAM (loss curves and inspection threshold)
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import Rectangle, FancyArrowPatch

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)

def create_relation_map():
    """
    Create r3_relation.png - the RELATION-MAP figure.
    Three columns: base domain | target domain | with labeled arrows.
    Base: smoke detector (fire_damage × probability > nuisance_cost)
    Target: calibrated inspection rule
    Arrows: "alarm threshold = cost ratio", "anomaly must be a probability, not a vibe"
    """
    fig, ax = plt.subplots(figsize=(12, 6.5), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # Title
    ax.text(6, 9.5, "R3 — the regret head is a smoke detector with priced errors",
            fontsize=11, weight='bold', ha='center', va='top')

    # Column 1: Base Domain (Smoke Detector Analogy)
    y_base = 7.0
    box1 = Rectangle((0.3, y_base-1.8), 3.0, 2.4,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.8, y_base+0.4, "Base Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(1.8, y_base-0.3, "Smoke Detector", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-0.7, "Fires when", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-1.1, "fire damage × probability", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-1.5, "> nuisance cost of checking", fontsize=9, ha='center', va='center')

    # Column 2: Target Domain (Calibrated Inspection Rule)
    y_target = 7.0
    box2 = Rectangle((8.7, y_target-1.8), 3.0, 2.4,
                          edgecolor=SEAGREEN, facecolor=SEAGREEN,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(10.2, y_target+0.4, "Target Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(10.2, y_target-0.3, "Calibrated Operator", fontsize=9, ha='center', va='center')
    ax.text(10.2, y_target-0.7, "Inspects item x iff", fontsize=9, ha='center', va='center')
    ax.text(10.2, y_target-1.1, "C_miss·a(x) ≥", fontsize=9, ha='center', va='center')
    ax.text(10.2, y_target-1.5, "c_att + C_fa·(1−a(x))", fontsize=9, ha='center', va='center')

    # Arrow 1: Base → Target (top)
    arrow1 = FancyArrowPatch((3.3, y_base+0.5), (8.7, y_target+0.5),
                            arrowstyle='->', mutation_scale=25,
                            linewidth=2, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow1)
    ax.text(6, y_base+1.3, "alarm threshold = cost ratio",
            fontsize=9, ha='center', va='bottom', style='italic', weight='bold', color=SHIPRED)

    # Arrow 2: Base → Target (bottom)
    arrow2 = FancyArrowPatch((3.3, y_base-0.8), (8.7, y_target-0.8),
                            arrowstyle='->', mutation_scale=25,
                            linewidth=2, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow2)
    ax.text(6, y_base-1.5, "anomaly must be a probability, not a vibe",
            fontsize=9, ha='center', va='top', style='italic', weight='bold', color=SHIPRED)

    # Bottom note
    ax.text(6, 2.5, "Calibration: a(x) = Pr(bad | evidence). Stakes: C_miss = cost if missed;",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(6, 1.9, "c_att = inspection cost; C_fa = cost of false alarm.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r3_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()

def create_regime_diagram():
    """
    Create r3_regime.png - the REGIME DIAGRAM figure.
    X-axis: calibrated posterior a(x) from 0 to 0.2
    Y-axis: expected loss
    Line 1: loss_if_ignored = C_miss·a (harborblue)
    Line 2: loss_if_inspected = c_att + C_fa·(1−a) (seagreen)
    Vertical shipred dashed line at a* = 6/105 ≈ 0.057
    Shade the inspect region (a > a*) with harborblue alpha 0.08
    """
    fig, ax = plt.subplots(figsize=(10, 6.5), dpi=150)

    # Parameters
    C_miss = 100
    c_att = 1
    C_fa = 5
    a_threshold = 6 / 105  # ≈ 0.057

    # x-axis range: calibrated posterior from 0 to 0.2
    a_values = np.linspace(0, 0.2, 300)

    # Loss curves
    loss_if_ignored = C_miss * a_values
    loss_if_inspected = c_att + C_fa * (1 - a_values)

    # Plot the two loss lines
    ax.plot(a_values, loss_if_ignored, linewidth=2.5, color=HARBORBLUE,
            label=f'loss if ignored: {C_miss}·a', zorder=2)
    ax.plot(a_values, loss_if_inspected, linewidth=2.5, color=SEAGREEN,
            label=f'loss if inspected: {c_att} + {C_fa}·(1−a)', zorder=2)

    # Shade the inspect region (a > a*)
    inspect_region = a_values > a_threshold
    ax.fill_between(a_values[inspect_region], 0, 30,
                    color=HARBORBLUE, alpha=0.08, label='inspect region (a > a*)', zorder=1)

    # Vertical dashed line at crossing point
    ax.axvline(x=a_threshold, color=SHIPRED, linestyle='--', linewidth=2.5, alpha=0.9, zorder=3)

    # Annotation for the crossing
    crossing_loss = C_miss * a_threshold
    ax.plot(a_threshold, crossing_loss, 'o', markersize=7, color=SHIPRED, zorder=5)
    ax.annotate(f'a* = {a_threshold:.3f}\ninspect above here\n[verified]',
                xy=(a_threshold, crossing_loss), xytext=(a_threshold+0.035, crossing_loss+4),
                fontsize=9, ha='left', va='bottom',
                bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                         edgecolor=SHIPRED, alpha=0.95, linewidth=1.5),
                arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.5))

    # Secondary annotation: SDT direction note
    ax.text(0.16, 24, "raising C_miss\nLOWERS the bar —\nthe corrected\nSDT direction",
            fontsize=9, ha='left', va='top', style='italic', color='gray',
            bbox=dict(boxstyle='round,pad=0.5', facecolor='white', alpha=0.85, linewidth=0.5))

    # Labels and title
    ax.set_xlabel('calibrated posterior a(x)', fontsize=10, weight='bold')
    ax.set_ylabel('expected loss', fontsize=10, weight='bold')
    ax.set_title("R3 regime — inspection pays exactly where the calibrated posterior crosses the cost ratio",
                 fontsize=11, weight='bold', pad=12)

    # Grid and spines
    ax.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_linewidth(1)
    ax.spines['bottom'].set_linewidth(1)

    # Legend
    ax.legend(loc='upper left', fontsize=9, framealpha=0.95)

    # Set axis limits
    ax.set_xlim(0, 0.2)
    ax.set_ylim(0, 26)

    # Prune any auto-generated ticks that fall outside the final view limits
    # (see note in r1_figures.py create_regime_diagram).
    fig.canvas.draw()
    ylo, yhi = ax.get_ylim()
    ax.set_yticks([t for t in ax.get_yticks() if ylo - 1e-9 <= t <= yhi + 1e-9])

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r3_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R3 figures created successfully.")
