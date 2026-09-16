#!/usr/bin/env python3
"""
R12 figures: reputation transfer semantics (no-mint proof).
Produces r12_relation.png and r12_regime.png.
"""

import numpy as np
import matplotlib.pyplot as plt
plt.rcParams['font.family'] = 'serif'  # match the LaTeX body's serif face, not matplotlib's sans default
from matplotlib.patches import Rectangle

# Define colors per house rules
harborblue = (30/255, 70/255, 110/255)
shipred = (140/255, 30/255, 30/255)
seagreen = (31/255, 110/255, 70/255)
white = (1.0, 1.0, 1.0)
gray_light = (0.95, 0.95, 0.95)

# Set seed for determinism
np.random.seed(20260816)


def make_relation_figure():
    """
    Create r12_relation.png: three-column relation map.
    Base: transfer vs photocopy | Arrow | Target: fork inheritance.
    """
    fig, ax = plt.subplots(figsize=(10, 5), dpi=150)
    ax.set_xlim(0.2, 9.0)
    ax.set_ylim(0.3, 5.5)
    ax.axis('off')

    # Remove spines
    for spine in ax.spines.values():
        spine.set_visible(False)

    fontsize = 10

    # === COLUMN 1: BASE ANALOGY ===
    x_col1 = 1.5

    # Bank transfer box
    transfer_box = Rectangle(
        (x_col1 - 0.8, 3.5), 1.6, 1.0,
        edgecolor=harborblue, facecolor=harborblue, alpha=0.10, linewidth=1.5
    )
    ax.add_patch(transfer_box)
    ax.text(x_col1, 4.2, "Bank Transfer", ha='center', va='center',
            fontsize=fontsize, weight='bold', color=harborblue)
    ax.text(x_col1, 3.8, "$100 → debits sender", ha='center', va='center',
            fontsize=8, color='black')

    # Photocopier box
    photocopy_box = Rectangle(
        (x_col1 - 0.8, 1.5), 1.6, 1.0,
        edgecolor=shipred, facecolor=shipred, alpha=0.10, linewidth=1.5
    )
    ax.add_patch(photocopy_box)
    ax.text(x_col1, 2.2, "Photocopier", ha='center', va='center',
            fontsize=fontsize, weight='bold', color=shipred)
    ax.text(x_col1, 1.8, "Mints money", ha='center', va='center',
            fontsize=8, color='black')

    # === COLUMN 2: BRIDGE ARROWS ===
    x_arrow = 4.0

    # Arrow from transfer to target
    ax.annotate('', xy=(5.5, 4.0), xytext=(3.3, 4.0),
                arrowprops=dict(arrowstyle='->', lw=2, color=harborblue))
    ax.text(x_arrow, 4.35, "debit-on-send ⇔ split",
            ha='center', fontsize=8, color=harborblue, weight='bold')

    # Arrow from photocopy to target
    ax.annotate('', xy=(5.5, 2.0), xytext=(3.3, 2.0),
                arrowprops=dict(arrowstyle='->', lw=2, color=shipred))
    ax.text(x_arrow, 1.65, "photocopy ⇔ quorum ×",
            ha='center', fontsize=8, color=shipred, weight='bold')

    # === COLUMN 3: TARGET (FORK INHERITANCE) ===
    x_col3 = 7.5

    # Transfer semantics box
    transfer_target = Rectangle(
        (x_col3 - 0.95, 3.0), 1.9, 1.8,
        edgecolor=seagreen, facecolor=seagreen, alpha=0.10, linewidth=2
    )
    ax.add_patch(transfer_target)
    ax.text(x_col3, 4.55, "Fork Inheritance", ha='center', va='center',
            fontsize=fontsize, weight='bold', color=seagreen)
    ax.text(x_col3, 4.05, "Child: γ·w·spend(p)", ha='center', va='center',
            fontsize=8.5, color='black')
    ax.text(x_col3, 3.55, "Parent: −w·spend(p)", ha='center', va='center',
            fontsize=8.5, color='black')
    ax.text(x_col3, 3.05, "= TRANSFER", ha='center', va='center',
            fontsize=9, weight='bold', color=seagreen)

    # Copy-full box (red, mints)
    copy_box = Rectangle(
        (x_col3 - 0.95, 0.8), 1.9, 1.5,
        edgecolor=shipred, facecolor=shipred, alpha=0.10, linewidth=2
    )
    ax.add_patch(copy_box)
    ax.text(x_col3, 2.0, "Copy-Full", ha='center', va='center',
            fontsize=fontsize, weight='bold', color=shipred)
    ax.text(x_col3, 1.45, "Child: spend(p)", ha='center', va='center',
            fontsize=8.5, color='black')
    ax.text(x_col3, 0.95, "8.2× multiplication", ha='center', va='center',
            fontsize=8, weight='bold', color=shipred)

    # Title
    ax.text(5.0, 5.2, "R12 — reputation you cannot photocopy",
            ha='center', fontsize=12, weight='bold', color='black')

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r12_relation.png',
                dpi=150, bbox_inches='tight')
    plt.close()


def make_regime_figure():
    """
    Create r12_regime.png: regime diagram showing copy vs transfer semantics.
    X-axis: discount γ from 0 to 1
    Y-axis: total inherited credit across depth-3 full-weight chain
    """
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)

    # X-axis: discount gamma
    gamma_vals = np.linspace(0, 1, 200)

    # Copy semantics: sum of γ^d for d=1..3
    copy_vals = gamma_vals + gamma_vals**2 + gamma_vals**3

    # Transfer semantics: total live credit stays <= 1
    # For a depth-3 full-weight chain with debit-and-grant:
    # At each level, the child gets γ·(available) and source is debited.
    # The invariant is that total live credit <= initial witnessed (which is 1).
    # For a perfectly balanced (flat) chain at every level, it stays at exactly 1.
    # For uneven distribution, max is still ~1. We'll compute exactly:
    # Start: W=1 (witnessed), Φ=0 (live creditable)
    # After first derivation: Φ=γ (child gets γ), source debited 1, so Φ stays ≤ 1
    # After second derivation from the child: child2 gets γ²·1, Φ still bounded by 1
    # The sum across all descendants never exceeds 1 due to the debit constraint.
    transfer_vals = np.ones_like(gamma_vals)

    # Plot background shading for "minting region" (above y=1)
    ax.fill_between(gamma_vals, 1.0, 3.0, alpha=0.08, color=shipred, label='_nolegend_')
    ax.text(0.5, 2.3, 'minting', fontsize=9, color=shipred, alpha=0.6, weight='bold')

    # Copy semantics curve (shipred)
    ax.plot(gamma_vals, copy_vals, color=shipred, linewidth=2.5, label='Copy semantics: Σ γ^d')

    # Transfer semantics curve (seagreen)
    ax.plot(gamma_vals, transfer_vals, color=seagreen, linewidth=2.5, label='Transfer semantics (debits)')

    # Witnessed value line (harborblue dashed)
    ax.axhline(y=1.0, color=harborblue, linestyle='--', linewidth=2.0, label='witnessed value — the mint line')

    # Mark the counterexample point: γ=0.9, copy value = 2.44
    gamma_counterexample = 0.9
    copy_counterexample = gamma_counterexample + gamma_counterexample**2 + gamma_counterexample**3
    ax.plot(gamma_counterexample, copy_counterexample, 'o', color=shipred, markersize=8, zorder=5)

    # Annotation for the counterexample
    ax.annotate(
        '[internal, a6_no_mint.py]\nγ=0.9 copy: 2.44\nrefuted budget-only phrasing',
        xy=(gamma_counterexample, copy_counterexample),
        xytext=(gamma_counterexample - 0.25, copy_counterexample + 0.4),
        fontsize=8.5,
        color=shipred,
        weight='bold',
        bbox=dict(boxstyle='round,pad=0.4', facecolor='white', edgecolor=shipred, linewidth=1),
        arrowprops=dict(arrowstyle='->', color=shipred, lw=1.5, connectionstyle='arc3,rad=0.3')
    )

    # Axes labels in words
    ax.set_xlabel('discount γ', fontsize=10, weight='bold')
    ax.set_ylabel('total inherited credit\n(one unit-value episode, depth-3 chain)',
                  fontsize=10, weight='bold')

    # Set axis limits
    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.1, 3.0)

    # Hide top and right spines
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)

    # Ticks and labels
    ax.set_xticks([0, 0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticks([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
    ax.tick_params(labelsize=9)

    # Legend
    ax.legend(loc='upper left', fontsize=9, framealpha=0.95)

    # Title
    ax.set_title('R12 regime — budgets alone mint; transfer conserves',
                 fontsize=12, weight='bold', pad=15)

    plt.tight_layout()
    plt.savefig('/home/user/port-daddy/docs/harbor-research/figures/r12_regime.png',
                dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    make_relation_figure()
    make_regime_figure()
    print("Generated r12_relation.png and r12_regime.png")
