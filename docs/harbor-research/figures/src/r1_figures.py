#!/usr/bin/env python3
"""
R1 Figures: information floor and regime diagram
- r1_relation.png: RELATION-MAP (base domain → target domain)
- r1_regime.png: REGIME DIAGRAM (open budget vs required bits)
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle, FancyArrowPatch
import math

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
    Three columns: base domain | target domain | with labeled arrows.
    """
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # Title
    ax.text(5, 9.5, "R1 — the digest is a message; the floor is its length",
            fontsize=11, weight='bold', ha='center', va='top')

    # Column 1: Base Domain (left)
    y_base = 7.5
    box1 = Rectangle((0.2, y_base-1.2), 2.6, 2,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.5, y_base+0.5, "Base Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(1.5, y_base-0.3, "Shared codebook", fontsize=9, ha='center', va='center')
    ax.text(1.5, y_base-0.7, "of flagged", fontsize=9, ha='center', va='center')
    ax.text(1.5, y_base-1.1, "m-subsets", fontsize=9, ha='center', va='center')

    # Column 2: Target Domain (right)
    y_target = 7.5
    box2 = Rectangle((7.2, y_target-1.2), 2.6, 2,
                          edgecolor=SEAGREEN, facecolor=SEAGREEN,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(8.5, y_target+0.5, "Target Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(8.5, y_target-0.3, "Operator digest", fontsize=9, ha='center', va='center')
    ax.text(8.5, y_target-0.7, "→ open budget", fontsize=9, ha='center', va='center')
    ax.text(8.5, y_target-1.1, "→ guaranteed catch", fontsize=9, ha='center', va='center')

    # Arrow 1: Base → Target (top)
    arrow1 = FancyArrowPatch((2.8, y_base+0.3), (7.2, y_target+0.3),
                            arrowstyle='->', mutation_scale=25,
                            linewidth=1.5, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow1)
    ax.text(5, y_base+0.8, "selects one of C(N,k)/C(m,k) coverings",
            fontsize=9, ha='center', va='bottom', style='italic')

    # Arrow 2: Base → Target (bottom)
    arrow2 = FancyArrowPatch((2.8, y_base-0.5), (7.2, y_target-0.5),
                            arrowstyle='->', mutation_scale=25,
                            linewidth=1.5, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow2)
    ax.text(5, y_base-1.2, "needs log₂(C(N,k)) − log₂(C(m,k)) bits",
            fontsize=9, ha='center', va='top', style='italic')

    # Bottom note
    ax.text(5, 2.5, "Interpretation: A B-bit digest selects which m-subset to open.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(5, 1.8, "Each covering accounts for C(m,k) of C(N,k) placements of k criticals.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r1_relation.png',
                dpi=150, bbox_inches='tight')
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
    m_values = np.linspace(1, N, 200)  # Start from 1 to avoid m < k issues
    x_values = m_values / N

    # Compute curves for k=1, 2, 4
    colors_k = {1: SEAGREEN, 2: HARBORBLUE, 4: SHIPRED}

    for k in [1, 2, 4]:
        B_star_values = []
        for m in m_values:
            m_int = int(m)
            if m_int >= k:
                B_star_values.append(compute_B_star(N, k, m_int))
            else:
                B_star_values.append(float('nan'))
        label = f'k={k}'
        ax.plot(x_values, B_star_values, linewidth=2, color=colors_k[k], label=label)

    # Shade region above k=2 curve
    B_star_k2 = []
    for m in m_values:
        m_int = int(m)
        if m_int >= 2:
            B_star_k2.append(compute_B_star(N, 2, m_int))
        else:
            B_star_k2.append(float('nan'))
    B_star_k2 = np.array(B_star_k2)
    max_b = np.nanmax(B_star_k2)
    ax.fill_between(x_values, B_star_k2, max_b+2,
                     color=HARBORBLUE, alpha=0.08, label='zero-miss guarantee possible')

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
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r1_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("Figures created successfully.")
