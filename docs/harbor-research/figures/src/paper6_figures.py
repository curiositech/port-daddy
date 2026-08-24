#!/usr/bin/env python3
"""
Paper 6 figures: What Needs an Authority (R17 deontic fragment + R15 specialization)
- paper6_relation.png: RELATION-MAP (working port -> harbor authority inventory)
- paper6_regime.png:   REGIME DIAGRAM (exact g vs falsified g-tilde; succession price D*)
Deterministic; canon palette; seed set for house discipline (no sampling used).
"""

import numpy as np

np.random.seed(20260816)

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Rectangle

HARBORBLUE = (30 / 255, 70 / 255, 110 / 255)
SHIPRED = (140 / 255, 30 / 255, 30 / 255)
SEAGREEN = (31 / 255, 110 / 255, 70 / 255)

OUT = '/home/user/port-daddy/docs/harbor-research/figures'


def create_relation_map():
    fig, ax = plt.subplots(figsize=(12, 7.6), dpi=150)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 10.6)
    ax.axis('off')

    ax.text(6, 10.3, "Paper 6 — the authority inventory: where the algorithm ends, the charter begins",
            fontsize=12, weight='bold', ha='center', va='top', color=HARBORBLUE)

    # Base domain (left): a working port
    ax.add_patch(Rectangle((0.2, 0.7), 3.6, 8.7, edgecolor=HARBORBLUE,
                           facecolor=HARBORBLUE, alpha=0.12, linewidth=1.5))
    ax.text(2.0, 9.05, "Base: a working port", fontsize=11, weight='bold',
            ha='center', va='center')

    # Target domain (right): the harbor daemon
    ax.add_patch(Rectangle((8.2, 0.7), 3.6, 8.7, edgecolor=SEAGREEN,
                           facecolor=SEAGREEN, alpha=0.12, linewidth=1.5))
    ax.text(10.0, 9.05, "Target: the agent harbor", fontsize=11, weight='bold',
            ha='center', va='center')

    rows = [
        # (y, base lines, target lines, arrow label lines)
        (7.4,
         ["Collision course:", "constant bearing,", "decreasing range —", "geometry any watch", "officer computes"],
         ["In-fragment conflict scan:", "Horn propagation +", "sweep-line + Bellman–Ford,", "polynomial witness", "(no judgment consumed)"],
         ["mechanical DETECTION", "no authority needed"]),
        (4.6,
         ["Give-way beyond the", "rulebook: harbor", "traffic control decides", "who yields"],
         ["Disjunctive obligations:", "conflict-freedom NP-complete —", "a chartered resolver", "must choose the discharge"],
         ["where the rulebook ends", "chartered RESOLUTION begins"]),
        (1.9,
         ["One licensed pilot", "vs a pool of tug crews;", "ports license a", "second pilot"],
         ["Sole role owner iff", "skill premium clears g(rho,c);", "no succession plan:", "viable only below D*"],
         ["sole OWNERSHIP is priced,", "not presumed"]),
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

    ax.text(6.0, 0.25, "The map carries relations, not scenery: refusable-by-rule vs decided-by-charter vs paid-for-by-premium.",
            fontsize=8.5, ha='center', va='center', style='italic')

    plt.tight_layout()
    plt.savefig(f'{OUT}/paper6_relation.png', dpi=150, bbox_inches='tight')
    plt.close()


def erlang_c(c, rho):
    a = c * rho
    s = sum(a ** k / np.math.factorial(k) for k in range(c))
    top = a ** c / np.math.factorial(c) / (1 - rho)
    return top / (s + top)


def create_regime_diagram():
    fig, (axA, axB) = plt.subplots(1, 2, figsize=(12, 5), dpi=150)

    # Panel A: exact g(rho,2) vs falsified g-tilde
    rho = np.linspace(0.02, 0.92, 300)
    g_exact = 1 + 2 * rho - rho ** 2
    g_tilde = 1 + rho / (1 - rho)  # c = 2
    cross = (3 - np.sqrt(5)) / 2

    axA.plot(rho, g_exact, color=SEAGREEN, lw=2.2, label=r'exact $g(\rho,2)=1+2\rho-\rho^2$')
    axA.plot(rho, g_tilde, color=SHIPRED, lw=2.0, ls='--',
             label=r'proposed $\tilde g=1+\rho/(1-\rho)$ (falsified)')
    left = rho <= cross
    axA.fill_between(rho[left], g_tilde[left], g_exact[left],
                     color=SHIPRED, alpha=0.18)
    right = rho >= cross
    axA.fill_between(rho[right], g_exact[right], np.minimum(g_tilde[right], 4.0),
                     color=HARBORBLUE, alpha=0.15)
    axA.axvline(cross, color='k', lw=0.9, ls=':')
    axA.text(cross + 0.012, 3.62, r'$\rho=(3-\sqrt{5})/2$', fontsize=9, rotation=90,
             va='top')
    axA.plot([0.1], [1.15], marker='x', ms=9, mew=2.4, color=SHIPRED)
    axA.text(0.115, 1.02, 'false-certify\n' r'$r=1.15$', fontsize=8.5, color=SHIPRED)
    axA.plot([0.5], [1.9], marker='o', ms=7, color=HARBORBLUE)
    axA.text(0.53, 1.78, 'false-reject\n' r'$r=1.9$', fontsize=8.5, color=HARBORBLUE)
    axA.text(0.09, 2.25, r'$\tilde g$ certifies,' '\nspecialist loses', fontsize=8.5,
             color=SHIPRED, style='italic')
    axA.text(0.55, 2.9, r'$\tilde g$ rejects,' '\nspecialist wins', fontsize=8.5,
             color=HARBORBLUE, style='italic')
    axA.set_ylim(0.9, 4.0)
    axA.set_xlim(0, 0.95)
    axA.set_yticks([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0])
    axA.set_xticks([0.0, 0.2, 0.4, 0.6, 0.8])
    axA.set_xlabel(r'utilization $\rho$', fontsize=10)
    axA.set_ylabel(r'skill premium $r=\mu_s/\mu_g$', fontsize=10)
    axA.set_title('Panel A — the exact boundary vs the falsified one ($c=2$, $A=0$)',
                  fontsize=10.5)
    axA.legend(fontsize=8.5, loc='upper left')

    # Panel B: succession price D*
    eta, K = 0.25, 1.0362
    x = np.linspace(0.0, 1.0, 300)
    winf = x / (eta * (1 + x))
    dstar = eta * K / (1 - eta * K)
    axB.plot(x, winf, color=SEAGREEN, lw=2.2,
             label=r'downtime floor $W_\infty=\xi/(\eta(\xi+\eta))$')
    axB.axhline(K, color=HARBORBLUE, lw=1.6, ls='--',
                label=r'pool cost line $K=A/(w\lambda)+W_{\mathrm{pool}}$')
    axB.axvline(dstar, color='k', lw=0.9, ls=':')
    axB.text(dstar + 0.015, 0.25, r'$D^\star=0.350$', fontsize=9, rotation=90)
    axB.fill_between(x[x >= dstar], winf[x >= dstar], 2.6, color=SHIPRED, alpha=0.15)
    axB.text(0.72, 2.15, 'pooling wins at\nEVERY skill premium', fontsize=9,
             color=SHIPRED, weight='bold', ha='center')
    axB.text(0.16, 1.65, 'sole ownership viable\nif the premium clears $g_A$',
             fontsize=9, color=SEAGREEN, ha='center')
    axB.plot([1.5 * dstar], [1.376], marker='o', ms=7, color=SHIPRED)
    axB.text(1.5 * dstar + 0.02, 1.30, r'$\mu_s=10^8$ still loses' '\n($W=1.376>K$)',
             fontsize=8.5, color=SHIPRED)
    axB.set_xlim(0, 1.0)
    axB.set_ylim(0, 2.6)
    axB.set_yticks([0.0, 0.5, 1.0, 1.5, 2.0, 2.5])
    axB.set_xticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
    axB.set_xlabel(r'death-rate $\times$ succession-time, $\xi/\eta$', fontsize=10)
    axB.set_ylabel(r'mean response time $W$', fontsize=10)
    axB.set_title(r'Panel B — the succession price ($\eta=0.25$, $K=1.036$)',
                  fontsize=10.5)
    axB.legend(fontsize=8.5, loc='upper left')

    plt.tight_layout()
    plt.savefig(f'{OUT}/paper6_regime.png', dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    create_relation_map()
    create_regime_diagram()
    print("Paper 6 figures created.")
