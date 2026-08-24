#!/usr/bin/env python3
"""
Paper 7 figures: the cohomology of equivocation.
- paper7_visibility.png : the three-tier observability contract
  (compared / relayed / severed) on one gossip graph, with the verdict
  each tier admits.
- paper7_radius.png : the CR-1 closed form r = |s| * sqrt(1 - R_eff(e))
  with the cycle family C_n marked and the cut-edge corner at R_eff = 1.

Deterministic: seed 20260816, no randomness actually consumed.
Canon palette: harborblue #1e466e, shipred #8c1e1e, seagreen #1f6e46.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
from matplotlib.lines import Line2D

HARBORBLUE = '#1e466e'
SHIPRED = '#8c1e1e'
SEAGREEN = '#1f6e46'
GREY = (0.45, 0.45, 0.45)

OUT = '/home/user/port-daddy/docs/harbor-research/figures'


def _node(ax, x, y, label, r=0.13):
    ax.add_patch(Circle((x, y), r, color=HARBORBLUE, zorder=3))
    ax.text(x, y, label, fontsize=8, ha='center', va='center',
            color='white', weight='bold', zorder=4)


def visibility_figure():
    fig, (axg, axt) = plt.subplots(
        1, 2, figsize=(12.5, 4.6), dpi=150,
        gridspec_kw={'width_ratios': [1.0, 1.35]})

    # ---- left panel: one gossip graph wearing all three tiers ----
    axg.set_xlim(-1.8, 2.6)
    axg.set_ylim(-1.6, 1.6)
    axg.set_aspect('equal')
    axg.set_xticks([])
    axg.set_yticks([])
    axg.axis('off')

    ang = np.linspace(0, 2 * np.pi, 7)[:6]
    pos = {i: (np.cos(ang[i]), np.sin(ang[i])) for i in range(6)}
    pos[6] = (2.2, 0.0)  # pendant witness behind a bridge

    def edge(i, j, style):
        (x0, y0), (x1, y1) = pos[i], pos[j]
        if style == 'compared':
            axg.plot([x0, x1], [y0, y1], '-', color=HARBORBLUE,
                     linewidth=2.0, zorder=1)
        elif style == 'relayed':
            axg.plot([x0, x1], [y0, y1], '--', color=SEAGREEN,
                     linewidth=2.2, zorder=1)
        elif style == 'severed':
            axg.plot([x0, x1], [y0, y1], ':', color=GREY,
                     linewidth=2.0, zorder=1)

    # cycle C6: compared everywhere except one relayed edge (0,1)
    for i in range(6):
        j = (i + 1) % 6
        edge(i, j, 'relayed' if (i, j) == (0, 1) else 'compared')
    # a severed chord across the cycle: no reports cross (3,1)
    edge(1, 3, 'severed')
    # a bridge to a pendant witness: relayed but on no cycle
    edge(0, 6, 'relayed')

    for i in range(7):
        _node(axg, *pos[i], str(i))

    axg.text(1.02, 0.72, 'relayed,\non a cycle', fontsize=8,
             color=SEAGREEN, ha='left', va='bottom', weight='bold')
    axg.text(-0.62, 0.30, 'severed', fontsize=8, color=GREY,
             ha='center', va='center', weight='bold')
    axg.text(1.62, 0.14, 'relayed,\ncut edge', fontsize=8,
             color=SEAGREEN, ha='center', va='bottom', weight='bold')
    axg.set_title('one gossip graph, three visibility tiers',
                  fontsize=10, weight='bold', pad=8)

    # ---- right panel: the contract, one row per tier ----
    axt.set_xlim(0, 10)
    axt.set_ylim(0, 10)
    axt.set_xticks([])
    axt.set_yticks([])
    axt.axis('off')
    rows = [
        (8.6, HARBORBLUE, '-', 'compared',
         'analyst cross-checks both endpoint reports on the edge;\n'
         'disagreement observed directly (pairwise detection).'),
        (5.6, SEAGREEN, '--', 'relayed',
         "endpoints' reports reach the analyst by gossip; the edge itself\n"
         'is never checked.  On a cycle: r > 0, detectable (200/200).\n'
         'On a cut edge: r = 0 by algebra, provably silent (max 1.5e-13).'),
        (2.2, GREY, ':', 'severed',
         'no report crosses; the block is a free variable of the\n'
         'completion; equivocation there is provably dark (0/200).'),
    ]
    for y, c, ls, name, desc in rows:
        axt.add_line(Line2D([0.3, 1.5], [y, y], color=c, linestyle=ls,
                            linewidth=2.2))
        axt.text(1.75, y, name, fontsize=10, weight='bold', color=c,
                 ha='left', va='center')
        axt.text(3.7, y, desc, fontsize=8.5, ha='left', va='center')
    axt.set_title('what each tier lets the completion residual prove',
                  fontsize=10, weight='bold', pad=8)

    fig.suptitle('The three-tier observability contract '
                 '[internal, sheaf_harness_v2.py]',
                 fontsize=11, weight='bold', y=1.00)
    plt.tight_layout(rect=[0, 0, 1, 0.94])
    plt.savefig(f'{OUT}/paper7_visibility.png', dpi=150,
                bbox_inches='tight')
    plt.close()


def radius_figure():
    fig, ax = plt.subplots(figsize=(9.5, 5.2), dpi=150)

    R = np.linspace(0, 1, 400)
    ax.plot(R, np.sqrt(1 - R), color=HARBORBLUE, linewidth=2.2,
            label=r'$r/|s| = \sqrt{1-R_{\mathrm{eff}}(e)}$')

    # the cycle family C_n: R_eff = (n-1)/n, r/|s| = 1/sqrt(n)
    ns = [4, 6, 8, 12]
    Rn = [(n - 1) / n for n in ns]
    yn = [1 / np.sqrt(n) for n in ns]
    ax.plot(Rn, yn, 'o', color=SEAGREEN, markersize=7, zorder=3,
            label=r'cycle family $C_n$:  $R_{\mathrm{eff}}=\frac{n-1}{n}$,'
                  r'  $r=|s|/\sqrt{n}$')
    for n, x, y in zip(ns, Rn, yn):
        ax.annotate(f'$C_{{{n}}}$', (x, y), xytext=(x + 0.012, y + 0.045),
                    fontsize=9, color=SEAGREEN)

    # highlight C6 with the harness number
    ax.annotate('$C_6$, lie $s=3$:  $r = 3\\sqrt{1-5/6} = 1.2247$',
                (5 / 6, 1 / np.sqrt(6)),
                xytext=(0.06, 0.32), fontsize=9.5, color=SEAGREEN,
                arrowprops=dict(arrowstyle='->', color=SEAGREEN, lw=1.2))

    # the cut-edge corner
    ax.plot([1.0], [0.0], 's', color=SHIPRED, markersize=8, zorder=3,
            label=r'cut edge: $R_{\mathrm{eff}}=1$, $r=0$ (provably silent)')
    ax.annotate('bridge / cut edge:\nfull leverage, zero residual',
                (1.0, 0.0), xytext=(0.52, 0.09), fontsize=9,
                color=SHIPRED,
                arrowprops=dict(arrowstyle='->', color=SHIPRED, lw=1.2))

    ax.set_xlabel(r'effective resistance $R_{\mathrm{eff}}(e)$ of the lied-on'
                  r' edge in its coordinate subgraph', fontsize=10)
    ax.set_ylabel(r'certified residual per unit lie,  $r/|s|$', fontsize=10)
    ax.set_xlim(-0.02, 1.05)
    ax.set_ylim(-0.05, 1.08)
    ax.set_xticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])
    ax.grid(alpha=0.25)
    ax.legend(fontsize=9, loc='upper right', framealpha=0.9)
    ax.set_title('CR-1 closed form: the lie the residual certifies, '
                 'by topology  [verified; sheaf_consistency_radius.py]',
                 fontsize=11, weight='bold', pad=10)

    plt.tight_layout()
    plt.savefig(f'{OUT}/paper7_radius.png', dpi=150, bbox_inches='tight')
    plt.close()


if __name__ == '__main__':
    np.random.seed(20260816)
    visibility_figure()
    radius_figure()
    print('paper7 figures created.')
