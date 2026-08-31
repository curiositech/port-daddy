#!/usr/bin/env python3
"""
R1 Figures: information floor and regime diagram
- r1_relation.png: RELATION-MAP (base domain → target domain)
- r1_regime.png: REGIME DIAGRAM (open budget vs required bits)
"""

from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch
import math

OUT = Path(__file__).resolve().parents[1]

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)

def binomial_coeff_log2(n, k):
    """
    Compute log2(C(n,k)) using lgamma for numerical stability.
    log(C(n,k)) = log(n!) - log(k!) - log((n-k)!)
                = lgamma(n+1) - lgamma(k+1) - lgamma(n-k+1)
    Returns log2.
    """
    if k > n or k < 0:
        return float('-inf')
    if k == 0 or k == n:
        return 0.0
    log_val = math.lgamma(n+1) - math.lgamma(k+1) - math.lgamma(n-k+1)
    return log_val / math.log(2)

def compute_B_star(N, k, m):
    """
    Compute B* = log2(C(N,k)) - log2(C(m,k))
    """
    return binomial_coeff_log2(N, k) - binomial_coeff_log2(m, k)

def create_relation_map():
    """
    Create r1_relation.png - the RELATION-MAP figure.
    Base domain (the combinatorial world of placements) vs target domain
    (the digest channel that must name one of them) across three rows that
    walk the whole argument: what's being counted, what the channel costs,
    and the verified boundary instance. Every row carries a red connective
    label describing the relation, in the house pattern.
    """
    fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10.6)
    ax.axis('off')

    ax.text(6, 10.3, "R1 — the digest is a message; the floor is its length",
            fontsize=12, weight='bold', ha='center', va='top', color=HARBORBLUE)

    # Base domain (left): the combinatorial world
    ax.add_patch(Rectangle((0.2, 0.7), 3.6, 8.7, edgecolor=HARBORBLUE,
                            facecolor=HARBORBLUE, alpha=0.12, linewidth=1.5))
    ax.text(2.0, 9.05, "Base: where the k criticals\ncould be hiding", fontsize=11,
            weight='bold', ha='center', va='center')

    # Target domain (right): the digest channel
    ax.add_patch(Rectangle((8.2, 0.7), 3.6, 8.7, edgecolor=SEAGREEN,
                            facecolor=SEAGREEN, alpha=0.12, linewidth=1.5))
    ax.text(10.0, 9.05, "Target: the digest that must\nname where to look", fontsize=11,
            weight='bold', ha='center', va='center')

    rows = [
        (7.4,
         ["N artifacts total,", "k of them load-bearing:", "C(N,k) ways to place", "the k criticals among N"],
         ["Shared codebook:", "every flagged m-subset", "covers only C(m,k) of", "those C(N,k) placements"],
         ["one digest selects", "ONE covering"]),
        (4.6,
         ["A digest of B literal bits", "is a message with", "2^B distinguishable", "values — no more"],
         ["Decoder: shared table", "of m-subsets; each", "message names one", "m-subset to open"],
         ["zero-miss needs", "B ≥ log₂C(N,k) − log₂C(m,k)"]),
        (1.9,
         ["Boundary instance:", "N=60, k=2 — oracle /", "noisy / random encoders", "run against the bound"],
         ["m=8 opened ⇒", "B* = 5.98 bits;", "0/16 floor violations", "[verified, a7_experiment.py]"],
         ["the floor holds", "exactly, not on average"]),
    ]

    for y, base_lines, target_lines, label_lines in rows:
        for i, s in enumerate(base_lines):
            ax.text(2.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
        for i, s in enumerate(target_lines):
            ax.text(10.0, y + 0.75 - 0.42 * i, s, fontsize=8.5, ha='center', va='center')
        arrow = FancyArrowPatch((3.9, y - 0.15), (8.1, y - 0.15), arrowstyle='<->',
                                 mutation_scale=20, linewidth=1.8, color=SHIPRED, alpha=0.85)
        ax.add_patch(arrow)
        for i, s in enumerate(label_lines):
            ax.text(6.0, y + 0.62 - 0.38 * i, s, fontsize=9, ha='center',
                    va='center', color=SHIPRED, weight='bold')

    ax.text(6.0, 0.25,
            "The map carries a combinatorial fact, not scenery: each flagged m-set can only ever cover "
            "C(m,k) of the C(N,k) ways k criticals could sit among N.",
            fontsize=8.5, ha='center', va='center', style='italic')

    plt.tight_layout()
    plt.savefig(OUT / 'r1_relation.png', dpi=150, bbox_inches='tight')
    plt.close()

def create_regime_diagram():
    """
    Create r1_regime.png - the REGIME DIAGRAM figure.
    X-axis: open budget fraction m/N
    Y-axis: required digest bits B*
    Three curves for k=1,2,4; N=60 fixed.
    Shade region above k=2 curve.
    Mark measured point.
    """
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)

    N = 60
    m_values = np.arange(1, N + 1)  # m is a count of opened artifacts: integers only
    x_values = m_values / N

    # Compute curves for k=1, 2, 4. B*(N,k,m) is a genuine step function of
    # the integer m (C(m,k) only changes at integer m), so draw it as one:
    # steps-post is the honest rendering, not an interpolation artifact.
    colors_k = {1: SEAGREEN, 2: HARBORBLUE, 4: SHIPRED}

    for k in [1, 2, 4]:
        B_star_values = np.array([
            compute_B_star(N, k, m) if m >= k else float('nan')
            for m in m_values
        ])
        ax.plot(x_values, B_star_values, drawstyle='steps-post',
                linewidth=2, color=colors_k[k], label=f'k={k}')

    # Shade region above the k=2 curve: the (m/N, B) pairs where a B-bit
    # digest actually clears the k=2 floor and a zero-miss guarantee is
    # achievable.
    B_star_k2 = np.array([
        compute_B_star(N, 2, m) if m >= 2 else float('nan')
        for m in m_values
    ])
    max_b = np.nanmax(B_star_k2)
    ax.fill_between(x_values, B_star_k2, max_b + 2, step='post',
                     color=HARBORBLUE, alpha=0.08, label='zero-miss guarantee possible (k=2)')

    # Mark the measured point: m/N = 8/60, B* = 5.98
    m_measured = 8
    B_measured = compute_B_star(N, 2, m_measured)
    x_measured = m_measured / N
    ax.plot(x_measured, B_measured, 'o', markersize=8, color=SHIPRED, zorder=5)

    # Annotation for measured point
    ax.annotate(f'measured: N=60, k=2, m=8\n→ {B_measured:.2f} bits [verified]',
                xy=(x_measured, B_measured), xytext=(x_measured+0.15, B_measured+1.5),
                fontsize=9, ha='left', va='bottom',
                bbox=dict(boxstyle='round,pad=0.4', facecolor='white',
                         edgecolor=SHIPRED, alpha=0.9, linewidth=1),
                arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.5))

    # Labels and title
    ax.set_xlabel('open budget fraction (m/N)', fontsize=10, weight='bold')
    ax.set_ylabel('required digest bits (B*)', fontsize=10, weight='bold')
    ax.set_title("R1 regime — the floor falls as the open budget grows; zero only at m=N",
                 fontsize=11, weight='bold', pad=12)

    # Grid and spines
    ax.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_linewidth(1)
    ax.spines['bottom'].set_linewidth(1)

    # Legend
    ax.legend(loc='upper right', fontsize=9, framealpha=0.95)

    # Set axis limits
    ax.set_xlim(0, 1)
    ax.set_ylim(0, max_b+2)

    # Prune any auto-generated ticks that fall outside the final view limits
    # (LogLocator/MaxNLocator can emit one boundary tick beyond an explicit
    # set_xlim/set_ylim; its Text stays "visible" though never actually drawn,
    # which trips a naive off-canvas check even though the saved PNG is clean).
    fig.canvas.draw()
    ylo, yhi = ax.get_ylim()
    ax.set_yticks([t for t in ax.get_yticks() if ylo - 1e-9 <= t <= yhi + 1e-9])

    plt.tight_layout()
    plt.savefig(OUT / 'r1_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("Figures created successfully.")
