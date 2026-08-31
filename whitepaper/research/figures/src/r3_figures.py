#!/usr/bin/env python3
"""
R3 Figures: regret head / inspection decision
- r3_relation.png: RELATION-MAP (smoke detector → calibrated posterior)
- r3_regime.png: REGIME DIAGRAM (loss curves and inspection threshold)
"""

from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

FIGURES_DIR = Path(__file__).resolve().parents[1]

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)

def create_relation_map():
    """
    Create r3_relation.png - the RELATION-MAP figure.
    Two full-height columns (Base: smoke detector | Target: derived regret head),
    each carrying three substantive rows (stakes, attention cost, calibrated
    anomaly) that build up to the exact inspect-iff threshold, plus a bold
    red connective label between every row (paper6_relation.png house style).
    """
    fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10.4)
    ax.axis('off')

    # Title
    ax.text(6, 10.05, "R3 — the derived regret head is a smoke detector with priced errors",
            fontsize=12, weight='bold', ha='center', va='top')

    box_bottom, box_top = 0.85, 9.15
    left_x0, left_x1 = 0.3, 4.05
    right_x0, right_x1 = 7.95, 11.7
    left_cx = (left_x0 + left_x1) / 2
    right_cx = (right_x0 + right_x1) / 2

    box_left = FancyBboxPatch((left_x0, box_bottom), left_x1 - left_x0, box_top - box_bottom,
                               boxstyle="round,pad=0.02,rounding_size=0.14",
                               edgecolor=HARBORBLUE, facecolor=HARBORBLUE, alpha=0.12,
                               linewidth=1.5)
    box_right = FancyBboxPatch((right_x0, box_bottom), right_x1 - right_x0, box_top - box_bottom,
                                boxstyle="round,pad=0.02,rounding_size=0.14",
                                edgecolor=SEAGREEN, facecolor=SEAGREEN, alpha=0.12,
                                linewidth=1.5)
    ax.add_patch(box_left)
    ax.add_patch(box_right)

    # Column headings
    ax.text(left_cx, box_top - 0.45, "Base: the household smoke detector",
            fontsize=10.5, weight='bold', ha='center', va='center')
    ax.text(right_cx, box_top - 0.45, "Target: the derived regret head",
            fontsize=10.5, weight='bold', ha='center', va='center')

    row_ys = [6.85, 4.55, 2.25]

    rows = [
        ("Stakes",
         "Value at risk if the\nroom really is burning:\nreplacement cost ×\nhow bad the loss is",
         "Stakes",
         "C_miss(x) = magnitude\nof loss × irreversibility\nof the action —\nthe price of being wrong"),
        ("Attention cost",
         "Cost of dragging the\nladder out for nothing:\nlost time, an annoyed\nhousehold, a wasted trip",
         "Attention cost",
         "c_att = analyst time to\ninspect one item;\nC_fa = cost of a false\nalarm that burns trust"),
        ("Anomaly reading",
         "Detector's raw sensor\nvalue — a gut-feel\n“looks smoky enough\nto worry about”",
         "Calibrated anomaly",
         "a(x) = Pr(bad | evidence),\nfit and checked against\nthe audit log — a real\nprobability, not a score"),
    ]

    for (y, (lh, lb, rh, rb)) in zip(row_ys, rows):
        ax.text(left_cx, y + 0.95, lh, fontsize=9.5, weight='bold', ha='center', va='center',
                color=HARBORBLUE)
        ax.text(left_cx, y, lb, fontsize=9, ha='center', va='center', linespacing=1.55)
        ax.text(right_cx, y + 0.95, rh, fontsize=9.5, weight='bold', ha='center', va='center',
                color=SEAGREEN)
        ax.text(right_cx, y, rb, fontsize=9, ha='center', va='center', linespacing=1.55)

    connectives = [
        "stakes × irreversibility —\na priced consequence, not a knob you tune",
        "crying wolf has a price too:\nc_att + C_fa·(1−a(x))",
        "anomaly must be a\nprobability, not a vibe",
    ]
    for y, label in zip(row_ys, connectives):
        arrow = FancyArrowPatch((left_x1 + 0.08, y), (right_x0 - 0.08, y),
                                 connectionstyle="arc3,rad=0.18",
                                 arrowstyle='<->', mutation_scale=18,
                                 linewidth=2, color=SHIPRED, alpha=0.85, zorder=3)
        ax.add_patch(arrow)
        ax.text((left_x1 + right_x0) / 2, y + 0.62, label, fontsize=9, ha='center', va='bottom',
                style='italic', weight='bold', color=SHIPRED, linespacing=1.4)

    # Synthesis line: the exact threshold, tying the three rows together
    ax.text(6, 0.35,
            "Inspect item x iff  C_miss(x)·a(x) ≥ c_att + C_fa·(1−a(x))   —   "
            "at C_miss=100, c_att=1, C_fa=5: threshold a ≥ 6/105 ≈ 0.057 [verified]",
            fontsize=9.5, ha='center', va='center', style='italic', color='dimgray')

    plt.tight_layout()
    plt.savefig(FIGURES_DIR / 'r3_relation.png',
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
    plt.savefig(FIGURES_DIR / 'r3_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R3 figures created successfully.")
