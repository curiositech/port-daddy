#!/usr/bin/env python3
"""
Harbor R9 figures: sealed-room noninterference.
Two figures: relation-map (voting-booth analogy) and regime diagram (gate behavior).
"""

from pathlib import Path

import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyBboxPatch, FancyArrowPatch

FIGURES_DIR = Path(__file__).resolve().parents[1]

# House colors
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)


def figure_r9_relation():
    """
    R9 Relation Map: sealed airlock (physical) -> sealed-room noninterference (formal).
    Three substantive Base/Target rows with bold connective labels, in the
    idiom of paper6_relation.png -- no wasted canvas.
    """
    fig, ax = plt.subplots(figsize=(12, 7.8), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 9.8)
    ax.axis('off')

    # Title
    ax.text(6, 9.45, "R9 — every release explicit, gated, and bounded",
            fontsize=13, weight='bold', ha='center', va='top')
    ax.text(6, 9.02, "sealed airlock  ⟷  sealed-room noninterference modulo declassification",
            fontsize=9.5, ha='center', va='top', style='italic', color=(0.35, 0.35, 0.35))

    box_w = 4.5
    box_h = 2.15
    left_x = 0.25
    right_x = 12 - 0.25 - box_w
    row_tops = [8.1, 5.55, 3.0]  # top y of each row's boxes

    def side_box(x, y_top, color, title, lines, sublines=None):
        box = FancyBboxPatch((x, y_top - box_h), box_w, box_h,
                              boxstyle="round,pad=0.08,rounding_size=0.12",
                              edgecolor=color, facecolor=color, alpha=0.12, linewidth=1.6)
        ax.add_patch(box)
        cx = x + box_w / 2
        ax.text(cx, y_top - 0.32, title, fontsize=10.5, weight='bold', ha='center', va='top')
        y = y_top - 0.78
        for ln in lines:
            ax.text(cx, y, ln, fontsize=9.3, ha='center', va='top')
            y -= 0.36
        if sublines:
            y -= 0.06
            for ln in sublines:
                ax.text(cx, y, ln, fontsize=8.3, ha='center', va='top', color='gray')
                y -= 0.32

    # ===== ROW 1: the mechanism =====
    side_box(left_x, row_tops[0], HARBORBLUE, "Sealed airlock",
              ["Derek moves freely inside the chamber;", "the outer door cycles only at"],
              ["declared checkpoints — never mid-transit"])
    side_box(right_x, row_tops[0], SEAGREEN, "Gate g(s) = s mod 2",
              ["Derek's process holds secret s;", "only g(s) ever crosses the boundary"],
              ["never s itself"])

    # ===== ROW 2: the invariant =====
    side_box(left_x, row_tops[1], HARBORBLUE, "Erin, at the porthole",
              ["Sees only the checkpoint light —", "one occupant or another, indistinguishable"],
              ["whenever the door-log matches"])
    side_box(right_x, row_tops[1], SEAGREEN, "Erin's observation trace",
              ["Identical for any s, s′ with g(s)=g(s′),", "under every interleaving of steps"],
              ["unwinding: Derek-side actions never touch", "Erin-observable state ('local respect')"])

    # ===== ROW 3: the proof =====
    side_box(left_x, row_tops[2], HARBORBLUE, "Inspector's logbook",
              ["Every door-sequence and occupant swap", "re-run — the light never tells them apart"],
              ["except at a checkpoint itself"])
    side_box(right_x, row_tops[2], SHIPRED, "Exhaustive + mutated",
              ["All secret pairs × all interleavings", "to depth 7 [c1_noninterference.py]"],
              ["leaky-gate: caught distinguishing (0,2)", "bypass: caught in 3 steps"])

    # ===== CONNECTIVE ARROWS (curved, labeled) =====
    def connector(y_top, label, color=SHIPRED, rad=0.18):
        y_mid = y_top - box_h / 2
        x0 = left_x + box_w
        x1 = right_x
        arrow = FancyArrowPatch((x0, y_mid), (x1, y_mid),
                                 connectionstyle=f"arc3,rad={rad}",
                                 arrowstyle='<->', mutation_scale=20, linewidth=2.1,
                                 color=color, alpha=0.9)
        ax.add_patch(arrow)
        ax.text((x0 + x1) / 2, y_mid + rad * (x1 - x0) / 2 + 0.28, label,
                fontsize=9.3, ha='center', va='bottom', weight='bold', color=color)

    connector(row_tops[0], "the only door is the gate", rad=0.14)
    connector(row_tops[1], "equal release ⇒ equal view", rad=0.14)
    connector(row_tops[2], "checked, not assumed", color=SHIPRED, rad=0.14)

    # Bottom interpretive caption
    ax.text(6, 0.52,
            "Two directions, one theorem: R5 says gate the channel; R9 says the gate suffices",
            fontsize=9.3, ha='center', va='center', style='italic', color=(0.3, 0.3, 0.3))
    ax.text(6, 0.18,
            "(Goguen–Meseguer noninterference modulo declassification; Rushby unwinding, local-respect condition).",
            fontsize=8.6, ha='center', va='center', style='italic', color=(0.45, 0.45, 0.45))

    plt.tight_layout()
    plt.savefig(FIGURES_DIR / 'r9_relation.png',
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
        "Seagreen (holds): honest gate enforces identity on equal-parity secret pairs.",
        "Harborblue (holds): honest gate isolates any difference to the gate-release event only.",
        "Red (caught): every mutation is caught — it leaks information the honest gate hides.",
    ]
    for k, line in enumerate(legend_lines):
        ax.text(grid_left + 0.15, legend_y_top - 0.3 - k * 0.35, line,
                ha='left', va='center', fontsize=9, color=(0.25, 0.25, 0.25))

    plt.tight_layout()
    plt.savefig(FIGURES_DIR / 'r9_regime.png',
                dpi=150, bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)


if __name__ == '__main__':
    # Generate both figures
    figure_r9_relation()
    figure_r9_regime()

    # Verify file sizes
    import os
    for fname in ['r9_relation.png', 'r9_regime.png']:
        fpath = FIGURES_DIR / fname
        if os.path.exists(fpath):
            size = os.path.getsize(fpath)
            print(f'{fname}: {size} bytes')
        else:
            print(f'{fname}: NOT FOUND')
