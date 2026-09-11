#!/usr/bin/env python3
"""
R2 Figures: split-digest theorem
- r2_relation.png: RELATION-MAP (thermometer analogy -> digest head analogy)
- r2_regime.png: REGIME DIAGRAM (super-additivity of floors)
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import math

# House colors (from task)
HARBORBLUE = (30/255, 70/255, 110/255)
SHIPRED = (140/255, 30/255, 30/255)
SEAGREEN = (31/255, 110/255, 70/255)


def compute_floor(N, k, m):
    """
    Floor(N,k,m) = log2(C(N,k)) - log2(C(m,k))  [bits needed to zero-miss-identify
    a k-subset of critical items out of N, given a compressed digest of size m].
    Elementary: math.comb is exact for these sizes, math.log2 for the bit count.
    """
    if k > N or k < 0 or k > m:
        return float('-inf')
    return math.log2(math.comb(N, k)) - math.log2(math.comb(m, k))


def create_relation_map():
    """
    r2_relation.png - RELATION-MAP.
    Base domain: one thermometer serving a chef and a doctor.
    Target domain: one digest head serving a successor agent and an operator.
    Three rows, each with substantive multi-line content on both sides and a
    bold red connective label describing the relation:
      1. comonotone case  -- orders agree, one instrument suffices
      2. crossing case    -- the constructible counterexample R2 is built on
      3. consequence       -- two instruments are necessary and sufficient,
                               with the measured super-additivity numbers.
    """
    fig, ax = plt.subplots(figsize=(12, 8.2), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10.6)
    ax.axis('off')

    # Title
    ax.text(6, 10.15, "R2 -- one number serves two readers only if their orders never cross",
            fontsize=12, weight='bold', ha='center', va='top')

    # ===== Tall domain boxes (rounded, span nearly the full height) =====
    box_top, box_bot = 9.3, 0.75
    box_w = 3.55
    base_box = FancyBboxPatch((0.25, box_bot), box_w, box_top - box_bot,
                               boxstyle="round,pad=0,rounding_size=0.12",
                               edgecolor=HARBORBLUE, facecolor=HARBORBLUE, alpha=0.12,
                               linewidth=1.6)
    ax.add_patch(base_box)
    target_box = FancyBboxPatch((8.2, box_bot), box_w, box_top - box_bot,
                                 boxstyle="round,pad=0,rounding_size=0.12",
                                 edgecolor=SEAGREEN, facecolor=SEAGREEN, alpha=0.12,
                                 linewidth=1.6)
    ax.add_patch(target_box)

    x_base = 0.25 + box_w / 2
    x_target = 8.2 + box_w / 2

    ax.text(x_base, box_top - 0.35, "Base: one thermometer", fontsize=11, weight='bold',
            ha='center', va='center', color=HARBORBLUE)
    ax.text(x_target, box_top - 0.35, "Target: one digest head", fontsize=11, weight='bold',
            ha='center', va='center', color=SEAGREEN)

    def stack(x, y_center, lines, styles=None):
        """Draw a small vertically-stacked block of lines centered at y_center."""
        n = len(lines)
        line_h = 0.34
        y0 = y_center + (n - 1) * line_h / 2
        for i, line in enumerate(lines):
            kw = dict(fontsize=8.8, ha='center', va='center')
            if styles and i in styles:
                kw.update(styles[i])
            ax.text(x, y0 - i * line_h, line, **kw)

    # Row y-centers within the boxes
    y1, y2, y3 = 7.55, 4.9, 2.15

    # ---- Row 1: comonotone case (orders agree) ----
    stack(x_base, y1, [
        "Nursery thermometer, night shift",
        "Parent ranks rooms by raw temp:",
        "coldest first, warmest last",
        "Night nurse ranks the same way",
        "same order -- one probe suffices",
    ], styles={4: dict(style='italic', color=SEAGREEN, weight='bold')})

    stack(x_target, y1, [
        "Compaction digest, routine batch",
        "Successor ranks by continuation",
        "value: least-recoverable-loss first",
        "Operator ranks the same batch the",
        "same way -- one score suffices",
    ], styles={4: dict(style='italic', color=SEAGREEN, weight='bold')})

    arrow1 = FancyArrowPatch((3.8, y1), (8.2, y1),
                              arrowstyle='<->', mutation_scale=18,
                              linewidth=1.5, color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow1)
    ax.text(6, y1 + 0.42, "COMONOTONE", fontsize=9.5, ha='center', va='bottom',
            weight='bold', color=SHIPRED)
    ax.text(6, y1 - 0.42, "orders agree ⇒ one instrument suffices",
            fontsize=8.8, ha='center', va='top', style='italic', color=SHIPRED)

    # ---- Row 2: the constructible crossing pair ----
    stack(x_base, y2, [
        "Sickroom thermometer, one reading",
        "Chef ranks 350°F oven-hot highest",
        "(wants the roast done)",
        "Doctor ranks 101°F fever-hot highest",
        "(wants the patient's fever tracked)",
    ], styles={4: dict(style='italic', color=SHIPRED, weight='bold')})

    stack(x_target, y2, [
        "Compaction digest, this batch",
        "Successor ranks routine-essential",
        "file X above stale experiment Y",
        "Operator ranks abandoned, irreversible",
        "experiment Y above routine file X",
    ], styles={4: dict(style='italic', color=SHIPRED, weight='bold')})

    arrow2 = FancyArrowPatch((3.8, y2), (8.2, y2),
                              arrowstyle='<->', mutation_scale=18,
                              linewidth=1.5, color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow2)
    ax.text(6, y2 + 0.42, "CROSSING", fontsize=9.5, ha='center', va='bottom',
            weight='bold', color=SHIPRED)
    ax.text(6, y2 - 0.42, "constructible crossing pair ⇒ orders diverge",
            fontsize=8.8, ha='center', va='top', style='italic', color=SHIPRED)

    # ---- Row 3: consequence -- two instruments, with the measured numbers ----
    stack(x_base, y3, [
        "Kitchen needs an oven probe.",
        "Sickroom needs a clinical thermometer.",
        "Two instruments, not one rescaled",
        "gauge, cover both readers at once.",
    ])

    stack(x_target, y3, [
        "Compaction needs a successor head",
        "and a separate operator head.",
        "Joint zero-miss floor ≈ 2.13× a single",
        "reader's floor (12.77 vs 5.98 bits) [verified]",
    ], styles={3: dict(color=HARBORBLUE)})

    arrow3 = FancyArrowPatch((3.8, y3), (8.2, y3),
                              arrowstyle='<->', mutation_scale=18,
                              linewidth=1.5, color=SHIPRED, alpha=0.85)
    ax.add_patch(arrow3)
    ax.text(6, y3 + 0.42, "CONSEQUENCE", fontsize=9.5, ha='center', va='bottom',
            weight='bold', color=SHIPRED)
    ax.text(6, y3 - 0.42, "⇒ two heads are necessary and sufficient",
            fontsize=8.8, ha='center', va='top', style='italic', color=SHIPRED)

    # Footer
    ax.text(6, 0.28,
            "The map carries relations, not scenery: comonotone-agree vs constructible-crossing vs the two-head consequence.",
            fontsize=9, ha='center', va='center', style='italic', color='dimgray')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r2_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()


def create_regime_diagram():
    """
    r2_regime.png - REGIME DIAGRAM, two panels computed directly from the
    closed form Floor(N,k,m) = log2 C(N,k) - log2 C(m,k):
      (a) N=60, m=8: naive 2x-Floor(k) vs the true joint Floor(2k), shaded gap,
          measured point k=2 (12.77 vs 11.96, ratio 1.067) annotated -- matches
          the compendium's verified arithmetic exactly.
      (b) the super-additivity ratio Floor(2k)/(2*Floor(k)) as a function of k,
          for two regimes (m=8 and m=20), showing the penalty is not a fluke
          of one measurement but grows with k across regimes.
    """
    fig, axes = plt.subplots(1, 2, figsize=(14, 6), dpi=150)
    ax1, ax2 = axes

    N = 60
    m = 8
    k_valid = np.arange(1, 5)  # k=1..4, where 2k <= m=8

    naive_2x = np.array([2 * compute_floor(N, k, m) for k in k_valid])
    true_joint = np.array([compute_floor(N, 2 * k, m) for k in k_valid])

    # ---- Panel (a): floor comparison ----
    ax1.plot(k_valid, naive_2x, color=SEAGREEN, linestyle='--', linewidth=2.5,
              label='two independent heads (naive 2×)', marker='o', markersize=5)
    ax1.plot(k_valid, true_joint, color=HARBORBLUE, linestyle='-', linewidth=2.5,
              label='true joint floor (disjoint readers)', marker='s', markersize=5)
    ax1.fill_between(k_valid, naive_2x, true_joint, color=SHIPRED, alpha=0.10,
                       label='super-additivity penalty')

    k_measured = 2
    idx = k_measured - 1
    tj_m, n2_m = true_joint[idx], naive_2x[idx]
    ax1.plot(k_measured, tj_m, 'o', markersize=10, color=SHIPRED, zorder=5)
    ax1.annotate(f'k=2: {tj_m:.2f} vs {n2_m:.2f}\nratio {tj_m/n2_m:.3f} [verified]',
                 xy=(k_measured, tj_m), xytext=(k_measured + 0.6, tj_m + 8),
                 fontsize=9, ha='left', va='bottom',
                 bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                           edgecolor=SHIPRED, alpha=0.95, linewidth=1.5),
                 arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.5))

    ax1.set_xlabel('items scored per reader (k)', fontsize=10, weight='bold')
    ax1.set_ylabel('joint zero-miss floor (bits)', fontsize=10, weight='bold')
    ax1.set_title('(a) N=60, m=8: joint floor beats naive doubling', fontsize=10.5, weight='bold')
    ax1.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.legend(loc='upper left', fontsize=8.5, framealpha=0.95)
    ax1.set_xlim(0.7, 4.3)
    ax1.set_xticks(k_valid)
    ax1.set_ylim(0, max(true_joint) * 1.25)

    # ---- Panel (b): super-additivity ratio vs k, two regimes ----
    def ratio_curve(N, m, k_max):
        ks = np.arange(1, k_max + 1)
        f1 = np.array([compute_floor(N, k, m) for k in ks])
        f2 = np.array([compute_floor(N, 2 * k, m) for k in ks])
        return ks, f2 / (2 * f1)

    ks_a, ratio_a = ratio_curve(60, 8, 4)
    ks_b, ratio_b = ratio_curve(60, 20, 10)

    ax2.axhline(1.0, color='gray', linewidth=1.2, linestyle=':',
                label='naive 2× baseline (ratio = 1)')
    ax2.plot(ks_a, ratio_a, color=HARBORBLUE, linewidth=2.5, marker='s', markersize=5,
              label='m=8 (matches panel a)')
    ax2.plot(ks_b, ratio_b, color=SEAGREEN, linewidth=2.5, marker='o', markersize=5,
              linestyle='--', label='m=20 (wider regime)')

    ax2.plot(2, ratio_a[1], 'o', markersize=10, color=SHIPRED, zorder=5)
    ax2.annotate(f'k=2, m=8: ratio {ratio_a[1]:.3f}\n[verified, matches (a)]',
                 xy=(2, ratio_a[1]), xytext=(4.3, 1.02),
                 fontsize=9, ha='left', va='bottom',
                 bbox=dict(boxstyle='round,pad=0.5', facecolor='white',
                           edgecolor=SHIPRED, alpha=0.95, linewidth=1.5),
                 arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.5))

    ax2.set_xlabel('items scored per reader (k)', fontsize=10, weight='bold')
    ax2.set_ylabel('Floor(2k) / (2·Floor(k))', fontsize=10, weight='bold')
    ax2.set_title('(b) the penalty grows with k across regimes', fontsize=10.5, weight='bold')
    ax2.grid(True, alpha=0.3, linestyle='--', linewidth=0.5)
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.legend(loc='upper left', fontsize=8.5, framealpha=0.95)
    ax2.set_xlim(0.5, 10.5)
    ax2.set_ylim(0.98, 1.45)

    fig.suptitle("R2 regime -- split floors are super-additive (12.77 vs 5.98 bits at k=2, not 2×)",
                 fontsize=11.5, weight='bold', y=1.03)

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r2_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("R2 figures created successfully.")
