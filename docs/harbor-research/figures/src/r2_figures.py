#!/usr/bin/env python3
"""
R2 Figures: split-digest theorem
- r2_relation.png: RELATION-MAP (thermometer analogy → digest head analogy)
- r2_regime.png: REGIME DIAGRAM (super-additivity of floors)
"""

import numpy as np
import matplotlib.pyplot as plt
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

def compute_floor(N, k, m):
    """
    Compute Floor(N,k,m) = log2(C(N,k)) - log2(C(m,k))
    """
    return binomial_coeff_log2(N, k) - binomial_coeff_log2(m, k)

def create_relation_map():
    """
    Create r2_relation.png - the RELATION-MAP figure.
    Three columns: base domain | target domain | labeled arrows.
    Base: thermometer cannot serve both chef and doctor with crossing orderings.
    Target: digest head cannot serve both successor and operator with crossing preferences.
    """
    fig, ax = plt.subplots(figsize=(12, 7), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10)
    ax.axis('off')

    # Title
    ax.text(6, 9.5, "R2 — one number serves two readers only if their orders never cross",
            fontsize=11, weight='bold', ha='center', va='top')

    # ===== BASE DOMAIN (left) =====
    y_base = 7.0
    box1 = Rectangle((0.2, y_base-1.8), 3.2, 2.4,
                          edgecolor=HARBORBLUE, facecolor=HARBORBLUE,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box1)
    ax.text(1.8, y_base+0.5, "Base Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(1.8, y_base-0.2, "One thermometer", fontsize=9, ha='center', va='center')
    ax.text(1.8, y_base-0.6, "Chef: wants oven-hot", fontsize=8, ha='center', va='center')
    ax.text(1.8, y_base-0.95, "Doctor: wants fever", fontsize=8, ha='center', va='center')
    ax.text(1.8, y_base-1.3, "ranking (orderings cross)", fontsize=8, ha='center', va='center',
            style='italic', color='darkred')

    # ===== TARGET DOMAIN (right) =====
    y_target = 7.0
    box2 = Rectangle((8.6, y_target-1.8), 3.2, 2.4,
                          edgecolor=SEAGREEN, facecolor=SEAGREEN,
                          alpha=0.15, linewidth=1.5)
    ax.add_patch(box2)
    ax.text(10.2, y_target+0.5, "Target Domain", fontsize=10, weight='bold',
            ha='center', va='center')
    ax.text(10.2, y_target-0.2, "One digest head", fontsize=9, ha='center', va='center')
    ax.text(10.2, y_target-0.6, "Successor: continuation", fontsize=8, ha='center', va='center')
    ax.text(10.2, y_target-0.95, "Operator: regret-if-ignored", fontsize=8, ha='center', va='center')
    ax.text(10.2, y_target-1.3, "score (preferences cross)", fontsize=8, ha='center', va='center',
            style='italic', color='darkred')

    # ===== UPPER ARROW (comonotone case) =====
    y_arrow_top = y_base + 0.5
    arrow1 = FancyArrowPatch((3.4, y_arrow_top), (8.6, y_arrow_top),
                            arrowstyle='<->', mutation_scale=20,
                            linewidth=1.5, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow1)
    ax.text(6, y_arrow_top + 0.5, "orders agree ⇔ one instrument suffices",
            fontsize=9, ha='center', va='bottom', style='italic', color=SHIPRED, weight='bold')

    # ===== LOWER ARROW (crossing case) =====
    y_arrow_bot = y_base - 1.5
    arrow2 = FancyArrowPatch((3.4, y_arrow_bot), (8.6, y_arrow_bot),
                            arrowstyle='<->', mutation_scale=20,
                            linewidth=1.5, color=SHIPRED, alpha=0.8)
    ax.add_patch(arrow2)
    ax.text(6, y_arrow_bot - 0.5, "constructible crossing pair ⇒ two heads required",
            fontsize=9, ha='center', va='top', style='italic', color=SHIPRED, weight='bold')

    # Bottom note
    ax.text(6, 2.8, "Comonotone: both readers rank the same items highest and lowest.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(6, 2.2, "Crossing: successor prefers X over Y, but operator prefers Y over X.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')
    ax.text(6, 1.6, "For crossing pairs, two separate digest heads are necessary and sufficient.",
            fontsize=9, ha='center', va='center', style='italic', color='gray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r2_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()

def create_regime_diagram():
    """
    Create r2_regime.png - the REGIME DIAGRAM figure.
    X-axis: number of items scored k (1..8, though limited by m=8 constraint)
    Y-axis: joint zero-miss floor in bits
    Two curves for N=60, m=8:
      (a) 2×Floor(N,k,m) in seagreen dashed: "two independent heads (naive 2×)"
      (b) Floor(N,2k,m) in harborblue solid: "true joint floor (disjoint readers)"
    Shade the gap between them (shipred alpha 0.10).
    Mark measured point k=2: 12.77 vs 11.96 with shipred dot + annotation.
    """
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)

    N = 60
    m = 8
    # Only valid k where 2k <= m (i.e., k <= 4), but extend x-axis for context
    k_valid = np.arange(1, 5)  # k from 1 to 4 (where 2k <= 8)
    k_full = np.arange(1, 9)   # For x-axis display

    # Compute the two curves (only for valid k)
    naive_2x = []  # 2 * Floor(N, k, m)
    true_joint = []  # Floor(N, 2k, m)

    for k in k_valid:
        floor_nk = compute_floor(N, k, m)
        floor_n2k = compute_floor(N, 2*k, m)
        naive_2x.append(2 * floor_nk)
        true_joint.append(floor_n2k)

    # Convert to numpy arrays
    naive_2x = np.array(naive_2x)
    true_joint = np.array(true_joint)

    # Plot curves
    ax.plot(k_valid, naive_2x, color=SEAGREEN, linestyle='--', linewidth=2.5,
            label='two independent heads (naive 2×)', marker='o', markersize=5)
    ax.plot(k_valid, true_joint, color=HARBORBLUE, linestyle='-', linewidth=2.5,
            label='true joint floor (disjoint readers)', marker='s', markersize=5)

    # Shade gap between curves
    ax.fill_between(k_valid, naive_2x, true_joint, color=SHIPRED, alpha=0.10,
                    label='super-additivity penalty')

    # Mark measured point: k=2, true_joint ≈ 12.77, naive_2x ≈ 11.96
    k_measured = 2
    idx_measured = k_measured - 1
    true_joint_measured = true_joint[idx_measured]
    naive_measured = naive_2x[idx_measured]

    ax.plot(k_measured, true_joint_measured, 'o', markersize=10, color=SHIPRED, zorder=5)

    # Annotation for measured point
    ratio = true_joint_measured / naive_measured
    ax.annotate(f'k=2: {true_joint_measured:.2f} vs {naive_measured:.2f}\nratio {ratio:.3f} [verified]',
                xy=(k_measured, true_joint_measured), xytext=(k_measured+1.2, true_joint_measured+1.5),
                fontsize=9, ha='left', va='bottom',
                bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                         edgecolor=SHIPRED, alpha=0.95, linewidth=1.5),
                arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.5))

    # Labels and title
    ax.set_xlabel('number of items scored (k)', fontsize=10, weight='bold')
    ax.set_ylabel('joint zero-miss floor (bits)', fontsize=10, weight='bold')
    ax.set_title("R2 regime — split floors are super-additive (≈2.13× one reader's floor, not 2×)",
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
    ax.set_xlim(0.5, 8.5)
    ax.set_ylim(0, max(true_joint) + 2)
    ax.set_xticks(k_full)

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r2_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()

if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R2 figures created successfully.")
