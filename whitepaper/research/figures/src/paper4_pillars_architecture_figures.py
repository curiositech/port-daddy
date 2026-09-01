#!/usr/bin/env python3
"""
Paper 4 figure: the four-pillar architecture, composed.

One pipeline figure showing how Pillars II, I, III, IV compose into a single
sealed-room contract, in the order the paper's closing section states it:
"enforceability (II) says where the boundary can be, noninterference (I) says
the boundary holds, conservation (III) meters what crosses it, and detection
(IV) polices evasion." Each stage box also names the gap left open if that
pillar alone were dropped, which is the connective-tissue argument the paper
makes in prose (Section 2's "close the design question" / Section 7's
"New, honestly" paragraph) rendered as one picture.

Deterministic: no randomness is used, so no seed is drawn, but the module
sets one anyway (20260816) for house-rule uniformity with the rest of the
figure corpus.
"""

from pathlib import Path

import numpy as np
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch  # noqa: E402

np.random.seed(20260816)

# Canon palette
HARBORBLUE = (30 / 255, 70 / 255, 110 / 255)
SHIPRED = (140 / 255, 30 / 255, 30 / 255)
SEAGREEN = (31 / 255, 110 / 255, 70 / 255)
INK = (0.20, 0.20, 0.20)

OUT = Path(__file__).resolve().parents[1]


def figure_pillars_architecture():
    fig, ax = plt.subplots(figsize=(13, 7.6), dpi=150)
    ax.set_xlim(0, 13.4)
    ax.set_ylim(0, 9)
    ax.axis('off')

    # ---- Title ----
    ax.text(6.85, 8.7, "The four pillars, composed into one sealed pipeline",
            fontsize=12, weight='bold', ha='center', va='top')
    ax.text(6.85, 8.28,
            "Each pillar closes a gap the other three leave open — drop any one and the account stops being auditable.",
            fontsize=9, ha='center', va='top', color='dimgray')

    # ---- Top: dual-attested key release (single entry point) ----
    top_box = Rectangle((4.75, 7.35), 4.2, 0.75, edgecolor=INK,
                         facecolor=(0.94, 0.94, 0.94), linewidth=1.2)
    ax.add_patch(top_box)
    ax.text(6.85, 7.85, "Derek + Erin — dual-attested key release",
            fontsize=9.5, weight='bold', ha='center', va='center')
    ax.text(6.85, 7.52, "the room is sealed from three sides at once",
            fontsize=8.3, ha='center', va='center', color='dimgray')

    entry_arrow = FancyArrowPatch((6.85, 7.35), (6.85, 6.95),
                                   arrowstyle='-|>', mutation_scale=18,
                                   linewidth=2.0, color=SHIPRED)
    ax.add_patch(entry_arrow)

    # ---- Sealed workroom boundary ----
    room = Rectangle((0.55, 3.3), 12.6, 3.6, edgecolor=(0.45, 0.45, 0.45),
                      facecolor='none', linewidth=1.1, linestyle=(0, (5, 3)))
    ax.add_patch(room)
    ax.text(0.85, 6.75, "sealed workroom — semantic handles only, no ambient network",
            fontsize=8, ha='left', va='top', color='dimgray')

    # ---- Four stage boxes ----
    cell_w, cell_h, gap = 2.7, 2.6, 0.35
    grid_left, y_top = 1.0, 6.35
    y_bottom = y_top - cell_h

    stages = [
        ("II — Mediation", "gate only $\\Sigma_c$: egress, write,\nexec, push, spawn",
         "if absent: no boundary is\nenforceable at all"),
        ("I — Declassification gate", "silence except through $g(s)$",
         "if absent: a gated channel could\nstill leak the raw secret"),
        ("III — $\\varepsilon$-ledger", "atomic append + spend,\n$\\sigma$ conserved",
         "if absent: honest releases could\nstill blow the contracted total"),
        ("IV — Canary + SPRT", "power $1-\\beta^k$, alarm\nclock on evasion",
         "if absent: leaks that dodge the\nledger go unnoticed"),
    ]

    box_centers = []
    for i, (title, role, gapline) in enumerate(stages):
        x0 = grid_left + i * (cell_w + gap)
        box = Rectangle((x0, y_bottom), cell_w, cell_h, edgecolor=HARBORBLUE,
                         facecolor=HARBORBLUE, alpha=0.10, linewidth=1.4)
        ax.add_patch(box)
        cx = x0 + cell_w / 2
        box_centers.append((x0, cx, x0 + cell_w))
        ax.text(cx, y_top - 0.32, title, fontsize=9.6, weight='bold',
                ha='center', va='top', color=HARBORBLUE)
        ax.text(cx, y_top - 0.95, role, fontsize=8.6, ha='center', va='top',
                color=INK)
        ax.text(cx, y_bottom + 0.62, gapline, fontsize=8.0, ha='center',
                va='center', color='dimgray')

    # Sequential arrows between stages (the composition order the paper states)
    for i in range(3):
        x_from = box_centers[i][2]
        x_to = box_centers[i + 1][0]
        arr = FancyArrowPatch((x_from + 0.03, y_bottom + cell_h / 2),
                               (x_to - 0.03, y_bottom + cell_h / 2),
                               arrowstyle='-|>', mutation_scale=14,
                               linewidth=1.4, color=(0.35, 0.35, 0.35))
        ax.add_patch(arr)

    # ---- Bottom: the composed, bounded outcome ----
    exit_arrow = FancyArrowPatch((6.85, 3.3), (6.85, 2.15),
                                  arrowstyle='-|>', mutation_scale=18,
                                  linewidth=2.0, color=HARBORBLUE)
    ax.add_patch(exit_arrow)

    out_box = Rectangle((1.0, 1.2), 11.85, 0.95, edgecolor=SEAGREEN,
                         facecolor=SEAGREEN, alpha=0.12, linewidth=1.4)
    ax.add_patch(out_box)
    ax.text(6.925, 1.86, "bounded leakage account: $q\\cdot b$ bits across $q$ jobs — priced, not eliminated",
            fontsize=9.6, weight='bold', ha='center', va='center', color=SEAGREEN)
    ax.text(6.925, 1.45, "timing, cache, and physical channels sit outside this account, declared so (§6)",
            fontsize=8.2, ha='center', va='center', color='dimgray')

    plt.tight_layout()
    plt.savefig(OUT / 'paper4_pillars_architecture.png', dpi=150,
                bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)


if __name__ == '__main__':
    figure_pillars_architecture()

    import os
    fname = 'paper4_pillars_architecture.png'
    fpath = OUT / fname
    if os.path.exists(fpath):
        print(f'{fname}: {os.path.getsize(fpath)} bytes')
    else:
        print(f'{fname}: NOT FOUND')
