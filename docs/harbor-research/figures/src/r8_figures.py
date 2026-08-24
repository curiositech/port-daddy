#!/usr/bin/env python3
"""
R8 figure pair: Work-unit machine (harbor-exposition Rail-B)
- r8_relation.png: Relation map (hospital case file analogy)
- r8_regime.png: Regime diagram (mutation suite shortest crimes)
"""

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch
import numpy as np

# Harbor color palette
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)

def set_plot_style():
    """Apply house style: hide spines, set font size."""
    ax = plt.gca()
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('gray')
    ax.spines['bottom'].set_color('gray')
    ax.tick_params(axis='both', which='major', labelsize=9)
    for label in ax.get_xticklabels() + ax.get_yticklabels():
        label.set_fontsize(9)

def figure_r8_relation():
    """
    RELATION-MAP: three columns showing hospital case file analogy.
    Base → Target mapping.
    """
    fig, ax = plt.subplots(figsize=(10, 3.0), dpi=150)
    ax.set_xlim(0, 10)
    ax.set_ylim(0.75, 4.3)
    ax.axis('off')

    # Title
    ax.text(5, 4.05, "R8 — the case file that outlives every clerk",
            ha='center', va='top', fontsize=11, weight='bold')

    # Column 1: Base (Hospital case file)
    col1_x = 1.5
    ax.text(col1_x, 3.4, "Base", ha='center', fontsize=10, weight='bold', color=HARBORBLUE)

    box1 = Rectangle((col1_x - 0.9, 2.5), 1.8, 0.75,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE, alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(col1_x, 2.87, "Hospital Case File", ha='center', va='center', fontsize=9, weight='bold')

    ax.text(col1_x, 2.05, "• Orders persist", ha='center', fontsize=9)
    ax.text(col1_x, 1.72, "• Survives staff turnover", ha='center', fontsize=9)
    ax.text(col1_x, 1.39, "• Nurses read chart,", ha='center', fontsize=9)
    ax.text(col1_x, 1.10, "  not memory", ha='center', fontsize=9)

    # Column 2: Arrows / Mapping — labels sit clear above each arrow shaft
    col2_x = 5
    arrow1 = FancyArrowPatch((col1_x + 1.0, 2.45), (col2_x - 0.8, 2.45),
                            arrowstyle='<->', mutation_scale=20,
                            color='gray', linewidth=1.5)
    ax.add_patch(arrow1)
    ax.text(col2_x, 3.05, "chart survives staff turnover", ha='center', fontsize=9, color='gray')
    ax.text(col2_x, 2.75, "⟺ work unit survives actor replacement", ha='center', fontsize=9, color='gray')

    arrow2 = FancyArrowPatch((col1_x + 1.0, 1.20), (col2_x - 0.8, 1.20),
                            arrowstyle='<->', mutation_scale=20,
                            color='gray', linewidth=1.5)
    ax.add_patch(arrow2)
    ax.text(col2_x, 1.80, "orders on chart", ha='center', fontsize=9, color='gray')
    ax.text(col2_x, 1.50, "⟺ grants with parentage", ha='center', fontsize=9, color='gray')

    # Column 3: Target (Evidence-carrying work unit)
    col3_x = 8.5
    ax.text(col3_x, 3.4, "Target", ha='center', fontsize=10, weight='bold', color=SHIPRED)

    box3 = Rectangle((col3_x - 0.9, 2.5), 1.8, 0.75,
                          edgecolor=SHIPRED, facecolor=SHIPRED, alpha=0.15, linewidth=1.5)
    ax.add_patch(box3)
    ax.text(col3_x, 2.87, "Evidence-Carrying Unit", ha='center', va='center', fontsize=9, weight='bold')

    ax.text(col3_x, 2.05, "• Grants fenced by epochs", ha='center', fontsize=9)
    ax.text(col3_x, 1.72, "• Advanced only by", ha='center', fontsize=9)
    ax.text(col3_x, 1.43, "  admitted evidence", ha='center', fontsize=9)
    ax.text(col3_x, 1.10, "• Settled once", ha='center', fontsize=9)

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r8_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()

def figure_r8_regime():
    """
    REGIME DIAGRAM: horizontal bar chart of mutation suite's shortest-crime lengths.
    Five guards with their shortest counterexample paths.
    """
    fig, ax = plt.subplots(figsize=(10, 5), dpi=150)

    # Data: shortest crimes (from R8 numbers)
    guards = [
        "Stale-epoch write",
        "Double settle",
        "Hollow verified",
        "Escalated delegation",
        "Wrong-principal payout"
    ]
    shortest_crimes = [4, 2, 4, 1, 7]

    # Y positions
    y_pos = np.arange(len(guards))

    # Create horizontal bars
    bars = ax.barh(y_pos, shortest_crimes, color=SHIPRED, alpha=0.8, edgecolor='none')

    # Add value labels at the end of bars
    for i, (bar, val) in enumerate(zip(bars, shortest_crimes)):
        ax.text(val + 0.15, i, str(val), va='center', fontsize=9, weight='bold')

    # Customize axes
    ax.set_yticks(y_pos)
    ax.set_yticklabels(guards, fontsize=9)
    ax.set_xlabel('Shortest counterexample when the guard is removed (steps)', fontsize=10)
    ax.set_title('R8 regime — every invariant has teeth: the shortest crime each guard prevents',
                 fontsize=11, weight='bold', pad=15)

    # Set x limits to give room for labels
    ax.set_xlim(0, 8)

    # Hide spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('gray')
    ax.spines['bottom'].set_color('gray')

    # Annotation box in seagreen
    annotation_text = ("all 536 reachable states satisfy all six invariants;\n"
                      "every guard proven load-bearing by mutation\n"
                      "[internal, c0_workunit.py]")

    props = dict(boxstyle='round', facecolor=SEAGREEN, alpha=0.2, edgecolor=SEAGREEN, linewidth=1.5)
    ax.text(0.98, 0.05, annotation_text, transform=ax.transAxes,
            fontsize=8, verticalalignment='bottom', horizontalalignment='right',
            bbox=props, family='monospace')

    # Adjust font sizes
    ax.tick_params(axis='both', which='major', labelsize=9)

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r8_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    figure_r8_relation()
    figure_r8_regime()
    print("✓ r8_relation.png and r8_regime.png generated")
