#!/usr/bin/env python3
"""
Harbor R9 figures: sealed-room noninterference.
Two figures: relation-map (voting-booth analogy) and regime diagram (gate behavior).
"""

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrowPatch

# House colors
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)


def figure_r9_relation():
    """
    R9 Relation Map: voting booth analogy -> sealed-room gate.
    Two domain columns (Base | Target) with labeled equivalence arrows,
    in the same idiom as the other R-series relation maps.
    """
    fig, ax = plt.subplots(figsize=(12, 6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 8)
    ax.axis('off')

    # Title
    ax.text(6, 7.6, "R9 — every release explicit, gated, and bounded",
            fontsize=11, weight='bold', ha='center', va='top')

    # ===== BASE DOMAIN (left): voting booth =====
    y_base = 5.4
    box1 = Rectangle((0.2, y_base - 2.0), 3.4, 2.9,
                      edgecolor=HARBORBLUE, facecolor=HARBORBLUE, alpha=0.12, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.9, y_base + 0.65, "Base Domain", fontsize=10, weight='bold', ha='center', va='center')
    ax.text(1.9, y_base + 0.2, "Voting booth turnstile", fontsize=9, ha='center', va='center')
    ax.text(1.9, y_base - 0.2, "“One click per PARTY,", fontsize=9, ha='center', va='center')
    ax.text(1.9, y_base - 0.55, "not per voter”", fontsize=9, ha='center', va='center')
    ax.text(1.9, y_base - 1.0, "Click = declared party tally", fontsize=9, ha='center', va='center')
    ax.text(1.9, y_base - 1.4, "3 voters, 2 parties: 3! orderings,", fontsize=8.5, ha='center', va='center', color='gray')
    ax.text(1.9, y_base - 1.7, "1 observable tally", fontsize=8.5, ha='center', va='center', color='gray')

    # ===== TARGET DOMAIN (right): sealed gate =====
    y_target = 5.4
    box2 = Rectangle((8.4, y_target - 2.0), 3.4, 2.9,
                      edgecolor=SEAGREEN, facecolor=SEAGREEN, alpha=0.12, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(10.1, y_target + 0.65, "Target Domain", fontsize=10, weight='bold', ha='center', va='center')
    ax.text(10.1, y_target + 0.2, "Sealed gate g(s) = s mod 2", fontsize=9, ha='center', va='center')
    ax.text(10.1, y_target - 0.2, "Release only the parity bit,", fontsize=9, ha='center', va='center')
    ax.text(10.1, y_target - 0.55, "never the secret s", fontsize=9, ha='center', va='center')
    ax.text(10.1, y_target - 1.0, "Bit = declared gate release", fontsize=9, ha='center', va='center')
    ax.text(10.1, y_target - 1.4, "secrets 0,2 (equal parity):", fontsize=8.5, ha='center', va='center', color='gray')
    ax.text(10.1, y_target - 1.7, "all interleavings, depth 7", fontsize=8.5, ha='center', va='center', color='gray')

    # ===== UPPER ARROW =====
    y_arrow_top = y_base + 0.9
    arrow1 = FancyArrowPatch((3.6, y_arrow_top), (8.4, y_arrow_top),
                              arrowstyle='<->', mutation_scale=22, linewidth=2.0,
                              color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow1)
    ax.text(6, y_arrow_top + 0.35, "declared tally ⇔ declared release bit",
            fontsize=9, ha='center', va='bottom', weight='bold', color=SHIPRED)

    # ===== LOWER ARROW =====
    y_arrow_bot = y_base - 1.85
    arrow2 = FancyArrowPatch((3.6, y_arrow_bot), (8.4, y_arrow_bot),
                              arrowstyle='<->', mutation_scale=22, linewidth=2.0,
                              color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow2)
    ax.text(6, y_arrow_bot - 0.4, "indistinguishable ballots ⇔ equal-parity secrets",
            fontsize=9, ha='center', va='top', weight='bold', color=SHIPRED)

    # Bottom interpretive notes
    ax.text(6, 1.5, "Pledge: observations identical whenever g(s) = g(s′), across all interleavings.",
            fontsize=9, ha='center', va='center', color='gray')
    ax.text(6, 1.0, "Only the declared release bit carries information — the sealed room never leaks the secret itself.",
            fontsize=9, ha='center', va='center', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r9_relation.png',
                dpi=150, bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)


def figure_r9_regime():
    """
    R9 Regime Diagram: categorical grid of secret pairs x gate variants,
    drawn as a clean table-style panel with plain rectangle cells.
    Rows: (0,2) equal parity, (0,1) unequal parity
    Cols: honest gate, leaky-gate mutant, bypass mutant
    """
    fig, ax = plt.subplots(figsize=(11, 6.2), dpi=150)
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 7)
    ax.axis('off')

    # Title
    ax.text(5.5, 6.75, 'R9 regime — what the gate promises, and the mutants that prove the checker sees',
            ha='center', va='top', fontsize=11, weight='bold')
    ax.text(5.5, 6.3, 'schedule secret-independence checked separately — an enabledness difference is itself a channel [internal, c1_noninterference.py]',
            ha='center', va='top', fontsize=9, color='gray')

    # Grid geometry
    rows = ['(0,2)\nequal parity', '(0,1)\nunequal parity']
    cols = ['Honest Gate', 'Leaky-Gate\nMutant', 'Bypass\nMutant']

    cell_width = 2.6
    cell_height = 1.7
    gap = 0.12
    grid_left = 1.9
    row_top = 5.3  # top edge of the header row

    # Column headers
    for j, col_label in enumerate(cols):
        x_pos = grid_left + j * (cell_width + gap)
        ax.text(x_pos + cell_width / 2, row_top + 0.25, col_label,
                ha='center', va='bottom', fontsize=10, weight='bold')

    cell_data = {
        (0, 0): (SEAGREEN, 'identical views', 'all interleavings, depth 7'),
        (1, 0): (HARBORBLUE, 'differs only at', 'gate release'),
        (0, 1): (SHIPRED, 'DISTINGUISHED', 'caught'),
        (1, 1): (SHIPRED, 'DISTINGUISHED', 'caught'),
        (0, 2): (SHIPRED, 'DISTINGUISHED', 'caught in 3 steps'),
        (1, 2): (SHIPRED, 'DISTINGUISHED', 'caught in 3 steps'),
    }

    for i, row_label in enumerate(rows):
        y_top = row_top - i * (cell_height + gap)
        y_bottom = y_top - cell_height
        # Row label
        ax.text(grid_left - 0.25, (y_top + y_bottom) / 2, row_label,
                ha='right', va='center', fontsize=10, weight='bold')

        for j in range(3):
            x_pos = grid_left + j * (cell_width + gap)
            color, text_main, text_sub = cell_data[(i, j)]
            cell = Rectangle((x_pos, y_bottom), cell_width, cell_height,
                              edgecolor='black', facecolor=color, alpha=0.75, linewidth=1.2)
            ax.add_patch(cell)
            ax.text(x_pos + cell_width / 2, y_bottom + cell_height * 0.62, text_main,
                    ha='center', va='center', fontsize=10, weight='bold', color='white')
            ax.text(x_pos + cell_width / 2, y_bottom + cell_height * 0.30, text_sub,
                    ha='center', va='center', fontsize=9, color='white')

    # Legend / interpretation strip at the bottom
    legend_y_top = row_top - 2 * (cell_height + gap) - 0.35
    legend_box = Rectangle((grid_left, legend_y_top - 1.1), 3 * cell_width + 2 * gap, 1.1,
                            edgecolor='gray', facecolor=(0.97, 0.97, 0.97), linewidth=0.8)
    ax.add_patch(legend_box)
    legend_lines = [
        "✓ Seagreen: honest gate enforces identity on equal-parity secret pairs.",
        "✓ Harborblue: honest gate isolates any difference to the gate-release event only.",
        "✗ Red: every mutation is caught — it leaks information the honest gate hides.",
    ]
    for k, line in enumerate(legend_lines):
        ax.text(grid_left + 0.15, legend_y_top - 0.3 - k * 0.35, line,
                ha='left', va='center', fontsize=9, color=(0.25, 0.25, 0.25))

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r9_regime.png',
                dpi=150, bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)


if __name__ == '__main__':
    # Generate both figures
    figure_r9_relation()
    figure_r9_regime()

    # Verify file sizes
    import os
    for fname in ['r9_relation.png', 'r9_regime.png']:
        fpath = f'/home/user/port-daddy/docs/harbor-research/figures/{fname}'
        if os.path.exists(fpath):
            size = os.path.getsize(fpath)
            print(f'{fname}: {size} bytes')
        else:
            print(f'{fname}: NOT FOUND')
